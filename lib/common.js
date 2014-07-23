/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file defines the object responsible for emitting periodic updates of
 * current VM usage information.
 */

var assert = require('assert-plus');
var fs = require('fs');
var kstat = require('kstat');
var path = require('path');
var sax = require('sax');
var parser = sax.parser(false, { lowercase: true });
var spawn = require('child_process').spawn;
var execFile = require('child_process').execFile;
var sprintf = require('extsprintf').sprintf;
var verror = require('verror');
var util = require('util');


/**
 * Return the boot timestemp of a VM.
 */

function bootTime(cb) {
    var reader = new kstat.Reader({
        module: 'unix',
        instance: 0,
        name: 'system_misc'
    });
    var stats = reader.read();
    cb(null, stats[0].data.boot_time);
}


function loadConfig(filename, callback) {
    fs.readFile(filename, function (error, data) {
        if (error) {
            callback(error);
            return;
        }
        callback(error, JSON.parse(data.toString()));
        return;
    });
}


function vmParse(zonexml, callback) {
    var resource = null;
    var network = null;
    var device = null;
    var zone = {};
    var deviceOrNetwork;

    parser.onerror = function (err) {
        callback(err, null);
    };

    parser.onopentag = function (node) {
        switch (node.name) {
            case 'rctl':
                resource = node.attributes.name.split(/zone./)[1];
                break;

            case 'rctl-value':
                zone[resource.replace(/-/g, '_')] = node.attributes.limit;
                break;

            case 'mcap':
                zone['mem_phys_cap'] = node.attributes.physcap;
                break;

            case 'attr':
                if (!zone.attributes) {
                    zone.attributes = {};
                }
                zone['attributes'][node.attributes.name]
                    = node.attributes.value;
                break;

            case 'zone':
                zone['name'] = node.attributes.name;
                zone['debugid'] = node.attributes.debugid;
                zone['zonepath'] = node.attributes.zonepath;
                zone['autoboot'] = node.attributes.autoboot;
                zone['brand'] = node.attributes.brand;
                break;

            case 'device':
                deviceOrNetwork = device = {};
                device['match'] = node.attributes['match'];
                break;

            case 'network':
                deviceOrNetwork = network = {};
                network['mac_addr'] = node.attributes['mac-addr'];
                network['vlan_id'] = node.attributes['vlan-id'];
                network['physical'] = node.attributes['physical'];
                network['global_nic'] = node.attributes['global-nic'];
                // we push it later on close (see onclosetag())
                break;

            case 'net-attr':
                deviceOrNetwork[node.attributes.name.replace(/-/g, '_')]
                    = node.attributes.value;
                break;

            default:
                break;
        }
    };

    parser.onclosetag = function (node) {
        switch (node) {
            case 'device':
                if (zone['devices'] == undefined) {
                    zone['devices'] = [];
                }
                zone['devices'].push(device);
                break;

            case 'network':
                if (zone['networks'] == undefined) {
                    zone['networks'] = [];
                }
                zone['networks'].push(network);
                break;

            default:
                break;
        }
    };

    parser.onend = function () {
        // final sets
        callback(null, zone);
    };

    parser.write(zonexml);
    parser.close();

}

function vmListFromFile(callback) {
    var zoneindex = '/etc/zones/index';

    fs.exists(zoneindex, function (exists) {
        if (exists) {
            fs.readFile(zoneindex, 'utf8', function (err, body) {
                var lines;
                if (err) {
                    callback(err, null);
                } else {
                    var zones = [];
                    lines = body.split(/\n/);
                    for (var i = 0; i < lines.length; i++) {
                        if (lines[i].match(/^#/) || lines[i] === '') continue;
                        var zone = {};
                        var line = lines[i].split(/:/);
                        zone['name'] = line[0];
                        zone['state'] = line[1];
                        zone['dataset'] = line[2] || '';
                        zone['uuid'] = line[3] || '';
                        zones.push(zone);
                    }
                    callback(null, zones);
                }
            });
        }
    });
}

function vmGet(name, callback) {
    var zonepath = '/etc/zones';
    var zonefile = path.join(zonepath, name + '.xml');

    fs.exists(zonefile, function (exists) {
        if (exists) {
            fs.readFile(zonefile, 'utf8', function (err, body) {
                if (err) {
                    callback(err, null);
                    return;
                } else {
                    vmParse(body, callback);
                }
            });
        } else {
            callback(new Error('no such zone configured'));
        }
    });
}


function sysinfo(callback) {
    execFile('/usr/bin/sysinfo', function (error, stdout, stderr) {
        if (error) {
            callback(new verror.VError(error, 'could not execute sysinfo'));
            return;
        }
        var s;
        try {
            s = JSON.parse(stdout.toString());
        } catch (ex) {
            error = new verror.VError(ex, 'could not parse sysinfo output');
        }
        callback(error, s);
    });
}


/*
 * Return an hour-aligned Date from the current date, putting the first minute
 * of the hour in the previous hour.  This function is used to select the log
 * file into which we will write a particular usage sample.
 */
function alignDateToHour(dt) {
    var t = new Date(dt);

    t.setUTCMilliseconds(0);
    t.setUTCSeconds(0);

    /*
     * We want to include 00:01:__ --> 01:00:__ in the file called T00.log:
     */
    if (t.getUTCMinutes() === 0)
        t.setUTCHours(t.getUTCHours() - 1);

    t.setUTCMinutes(0);

    return (t);
}


/*
 * Given a base directory, and a Date, generate the absolute path of the log
 * file to which we would write a sample for that timestamp.
 */
function usageFilePath(basedir, dt) {
    var h = alignDateToHour(dt);
    var sfx = sprintf('%04d-%02d-%02dT%02d.log',
      h.getUTCFullYear(), h.getUTCMonth() + 1, h.getUTCDate(),
      h.getUTCHours());
    return (path.join(basedir, sfx));
}


/*
 * Parse a log file name, converting it to an hour-aligned Date.  Return false
 * if the file name does not parse correctly.
 */
function parseUsageFileName(name) {
    var m = name.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}).log$/);
    if (!m)
        return (false);

    var dt = new Date(m[1] + 'T' + m[2] + ':00:00.000Z');

    /*
     * Date was not valid:
     */
    if (isNaN(dt.valueOf()))
        return (false);

    return (dt);
}


/*
 * Execution helper function:
 */

function readToEnd(stream, callback) {
    var cb = false;
    var data = '';
    stream.on('readable', function () {
        for (;;) {
            var ch = stream.read();
            if (!ch)
                return;
            data += ch.toString();
        }
    });
    stream.on('error', function (err) {
        if (cb)
            return;
        cb = true;
        callback(err);
    });
    stream.on('end', function () {
        if (cb)
            return;
        cb = true;
        callback(null, data);
    });
}


function runCommand(options, callback) {
    assert.object(options, 'options');
    assert.func(callback, 'callback');

    assert.string(options.command, 'options.command');
    assert.optionalArrayOfString(options.args, 'options.args');
    assert.optionalNumber(options.timeout, 'options.timeout');

    var timeo;
    var finished = false;
    var code;
    var signal;
    var stdout;
    var stderr;
    var done = {
        command: false,
        stdout: false,
        stderr: false
    };

    var format_err = function (errstr, err) {
        if (err)
            err = new verror.VError(err, errstr);
        else
            err = new verror.VError(errstr);

        err.command = options.command;
        err.args = options.args;
        err.exit_status = code;
        err.signal = signal;
        err.stderr = stderr;

        return (err);
    };

    var donecb = function (err, name) {
        if (finished)
            return;

        if (err) {
            finished = true;
            callback(format_err('execution failed', err));
            return;
        }

        done[name] = true;
        if (!done.command || !done.stdout || !done.stderr)
            return;

        finished = true;
        if (timeo)
            clearTimeout(timeo);

        if (code !== 0) {
            var errstr;
            if (signal) {
                errstr = util.format('command exited due ' +
                    'to signal %s', signal);
            } else {
                errstr = util.format('command exited non-' +
                    'zero (%d): %s', code, stderr);
            }

            callback(format_err(errstr));
            return;
        }

        callback(null, stdout);
    };

    var proc = spawn(options.command, options.args || [], {});

    readToEnd(proc.stdout, function (err, data) {
        stdout = data;
        if (err)
            err = format_err('could not read stdout', err);
        donecb(err, 'stdout');
    });
    readToEnd(proc.stderr, function (err, data) {
        stderr = data;
        if (err)
            err = format_err('could not read stderr', err);
        donecb(err, 'stderr');
    });

    proc.on('error', donecb);
    proc.on('exit', function (_code, _signal) {
        code = _code;
        signal = _signal;
        donecb(null, 'command');
    });

    if (options.timeout) {
        timeo = setTimeout(function () {
            try {
                proc.kill();
            } catch (ex) {
            }
            donecb(format_err('command execution timed out'));
        }, options.timeout);
    }
}


function splitPath(p) {
    var np = path.normalize(p);
    var elems = np.split(path.sep);

    /*
     * If we had a leading or trailing slash, there will be an empty
     * string at the beginning or end of the array.  Remove it:
     */
    if (elems[0] === '')
        elems.splice(0, 1);
    if (elems[elems.length - 1] === '')
        elems.splice(elems.length - 1, 1);

    return (elems);
}


module.exports = {
    bootTime: bootTime,
    loadConfig: loadConfig,
    vmGet: vmGet,
    vmListFromFile: vmListFromFile,
    sysinfo: sysinfo,
    alignDateToHour: alignDateToHour,
    parseUsageFileName: parseUsageFileName,
    runCommand: runCommand,
    splitPath: splitPath
};

/* vim: set sts=4 ts=4 sw=4 et: */
