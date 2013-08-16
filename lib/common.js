/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file defines the object responsible for emitting periodic updates of
 * current VM usage information.
 */

var fs = require('fs');
var kstat = require('kstat');
var path = require('path');
var sax = require('sax');
var parser = sax.parser(false, { lowercase: true });
var spawn = require('child_process').spawn;

/*
 * Generate random 4 byte strings of hexadecimal characters.
 */

function genId() {
    return Math.floor(Math.random() * 0xffffffff).toString(16);
}


/**
 * Join array of strings with a 'period'.
 */

function dotjoin() {
    return Array.prototype.join.call(arguments, '.');
}


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


module.exports = {
    dotjoin: dotjoin,
    genId: genId,
    bootTime: bootTime,
    loadConfig: loadConfig,
    vmParse: vmParse,
    vmGet: vmGet,
    vmListFromFile: vmListFromFile
};
