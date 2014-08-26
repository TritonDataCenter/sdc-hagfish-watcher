/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file defines the object responsible for emitting periodic updates of
 * current VM usage information.
 */

var util = require('util');
var events = require('events');
var zutil = require('zutil');
var common = require('./common');
var kstat = require('kstat');
var vasync = require('vasync');
var jsprim = require('jsprim');
var verror = require('verror');
var assert = require('assert-plus');
var path = require('path');



var HAGFISH_DATA_VERSION = 'HF4';


function getVirtualMachineUsage(timestamp, base_record, log, callback) {
    assert.date(timestamp);
    assert.object(base_record);
    assert.object(log);
    assert.func(callback);

    var start = Date.now();

    /*
     * Normalise the base record, and add in our data version and the
     * current timestamp:
     */
    base_record = JSON.parse(JSON.stringify(base_record));
    base_record.v = HAGFISH_DATA_VERSION;
    base_record.timestamp = (new Date(timestamp)).toISOString();

    var watcher_state = {
        base_record: base_record,
        log: log,
        vms: {},
        vmsTransformed: [],
        network: {},
        disk: {},
        vmPathsToZone: {},
        vmsToDataset: {},
        vmDatasetsToPath: {},
        w_pipeline: null,
        w_uvm_q: null,
        w_unw_pipeline: null
    };

    watcher_state.w_pipeline = vasync.pipeline({
        funcs: [
            updateNetworkUsage,
            updateVirtualMachines,
            updateDisk,
            transform
        ],
        arg: watcher_state
    }, function (err) {
        if (err) {
            var errstr = 'could not enumerate virtual machines';
            log.error({
                err: err,
                runtime: Date.now() - start
            }, errstr);
            callback(new verror.VError(err, errstr));
            return;
        }

        /*
         * Build the summary record:
         */
        var summary = makeSummary(watcher_state,
          watcher_state.vmsTransformed.length, Date.now() - start);
        log.info({
            summary: summary
        }, 'enumerated virtual machines');

        callback(null, watcher_state.vmsTransformed, summary);
    });
}


function makeSummary(ws, vm_count, runtime) {
    assert.object(ws);
    assert.number(vm_count);
    assert.number(runtime);

    var summary = makeRecord(ws, 'summary');

    summary.vm_count = vm_count;
    summary.runtime = runtime;

    return (summary);
}


function makeRecord(ws, type) {
    assert.object(ws);
    assert.object(ws.base_record);

    var out = jsprim.deepCopy(ws.base_record);

    out.type = type;

    return (out);
}


function transform(ws, callback) {
    assert.object(ws);
    assert.func(callback);

    var vmlist = Object.keys(ws.vms);

    var endfn = function (err) {
        setImmediate(callback, err || null);
    };

    for (var i = 0; i < vmlist.length; i++) {
        var vm = ws.vms[vmlist[i]];

        try {
            var vmt = makeRecord(ws, 'usage');

            vmt.uuid = vm.config.name;
            vmt.os_uuid = vm.os_uuid;
            vmt.status = vm.status;
            vmt.config = JSON.parse(JSON.stringify(vm.config));
            vmt.network_usage = ws.network[vmt.uuid];
            vmt.disk_usage = ws.disk[vm.uuid];

            ws.vmsTransformed.push(vmt);

        } catch (ex) {
            endfn(new verror.VError(ex, 'could not transform VM "%s"',
              vmlist[i]));
            return;
        }
    }

    endfn();
}


function debase64(str) {
    assert.string(str);

    return ((new Buffer(str, 'base64')).toString('utf8'));
}


function updateVirtualMachineWorker(task, next) {
    assert.object(task);
    assert.object(task.vm);
    assert.func(next);

    var z = task.vm;

    if (z.name === 'global') {
        next();
        return;
    }

    var vm = task.ws.vms[z.name] = {};
    vm.uuid = z.name;
    vm.os_uuid = z.uuid;

    var status;
    try {
        status = zutil.getZoneState(vm.uuid);
        vm.status = status;
    }
    catch (e) {
        if (e.message.match(/no such zone configured/i)) {
            task.ws.log.warn('Detected zone %s was destroyed', vm.uuid);
            next();
            return;
        }

        next(new verror.VError(e, 'zone state error for "%s"', vm.uuid));
        return;
    }

    common.vmGet(vm.uuid, function (error, vmrec) {
        if (error) {
            next(new verror.VError(error, 'vm get error for "%s"', vm.uuid));
            return;
        }

        vm.config = vmrec;

        if (vm.config.attributes.alias) {
            vm.config.attributes.alias = debase64(vm.config.attributes.alias);
        }

        /*JSSTYLED*/
        var dataset = z.dataset.replace(/^\//, '');
        task.ws.vmDatasetsToPath[dataset] = z.dataset;
        task.ws.vmPathsToZone[z.dataset] = z.name;
        task.ws.vmsToDataset[z.name] = dataset;

        next();
    });
}


function updateVirtualMachines(ws, callback) {
    assert.object(ws);
    assert.func(callback);

    var first_error = null;

    var q = ws.w_uvm_q = vasync.queuev({
        worker: updateVirtualMachineWorker,
        concurrency: 16
    });
    q.on('end', function () {
        callback(first_error);
    });

    var endfn = function (err) {
        if (err) {
            if (!first_error) {
                first_error = new verror.VError(err,
                  'updateVirtualMachines error');
            }
            ws.log.error({
                err: err
            }, 'updateVirtualMachines error');
        }
    };

    /*
     * Get the list of VMs and queue up the fetch:
     */
    common.vmListFromFile(function (err, vms) {
        if (err) {
            endfn(new verror.VError(err, 'vmListFromFile failed'));
        } else {
            for (var i = 0; i < vms.length; i++) {
                var vm = vms[i];
                q.push({
                    ws: ws,
                    vm: vm
                }, endfn);
            }
        }
        q.close();
    });
}


function updateNetworkUsage(ws, callback) {
    assert.object(ws);
    assert.func(callback);

    var bootTimestamp;
    var usage = {};

    var get_boot_time = function (_, next) {
        common.bootTime(function (err, boot_time) {
            if (err) {
                var errstr = 'common.bootTime failed';
                ws.log.error({
                    err: err
                }, errstr);
                next(new verror.VError(err, errstr));
                return;
            }
            bootTimestamp = boot_time;
            next();
        });
    };

    var read_kstats = function (_, next) {
        var reader = new kstat.Reader({
            module: 'link'
        });
        var stats = reader.read();
        var zoneRE = /z(\d+)_(.*)/;

        for (var i = 0; i < stats.length; i++) {
            var link = stats[i];

            var m = link.name.match(zoneRE);
            if (!m)
                continue;

            var zoneid = m[1];
            var linkname = m[2];
            var zonename = zutil.getZoneById(Number(zoneid)).name;

            if (!usage[zonename])
                usage[zonename] = {};

            if (!usage[zonename][linkname])
                usage[zonename][linkname] = {};

            var counter_start = (new Date(bootTimestamp * 1000 +
                Number(link.crtime) / 1000000000.0)).toISOString();

            usage[zonename][linkname] = {
                sent_bytes: link.data.obytes64,
                received_bytes: link.data.rbytes64,
                counter_start: counter_start
            };
        }

        next();
    };

    ws.w_unw_pipeline = vasync.pipeline({
        funcs: [
            get_boot_time,
            read_kstats
        ]
    }, function (err) {
        if (err) {
            ws.log.error({
                err: err
            }, 'updateNetworkUsage failed');
            callback(new verror.VError(err, 'updateNetworkUsage failed'));
            return;
        }
        ws.network = usage;
        callback();
    });
}


function zfsGet(log, callback) {
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var fields = [
        'name',
        'used',
        'available',
        'referenced',
        'type',
        'mountpoint',
        'quota',
        'origin',
        'volsize',
        'creation'
    ];
    var numKeys = [
        'used',
        'available',
        'referenced',
        'quota',
        'volsize',
        'creation'
    ];

    common.runCommand({
        command: '/sbin/zfs',
        args: [ 'get', '-Hp', '-o', 'name,property,value', fields.join(',') ],
        timeout: 10 * 60 * 1000
    }, function (err, stdout) {
        if (err) {
            callback(new verror.VError(err, 'zfsGet runCommand failed'));
            return;
        }

        var out = {};

        var lines = stdout.split(/\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line)
                continue;

            var terms = line.split(/\t/);
            if (terms.length !== 3) {
                callback(new verror.VError('could not parse line: %s', line));
                return;
            }

            var name = terms[0];
            var property = terms[1];
            var value = terms[2];

            log.trace({
                line: line,
                terms: terms,
                name: name,
                property: property,
                value: value
            }, 'zfsGet output line');

            if (!out[name])
                out[name] = {};

            if (numKeys.indexOf(property) !== -1 && value !== '-') {
                out[name][property] = parseInt(value, 10);
            } else {
                out[name][property] = value;
            }
        }

        callback(null, out);
    });
}


function updateDisk(ws, callback) {
    assert.object(ws);
    assert.func(callback);

    zfsGet(ws.log, function (err, datasets) {
        if (err) {
            ws.log.error({
                err: err
            }, 'zfsGet() error, aborting updateDisk()');

            /*
             * Note that we explicitly do not pass the error to the callback
             * chain here -- it is still of value to get _some_ telemetry
             * rather than _none_ in the face of unanticipated errors.
             */
            callback();
            return;
        }

        ws.log.trace({
            datasets: datasets
        }, 'enumerated ZFS datasets');

        for (var vm_uuid in ws.vms) {
            var vm = ws.vms[vm_uuid];

            if (!ws.disk[vm_uuid])
                ws.disk[vm_uuid] = {};

            var add = function (dsn) {
                ws.disk[vm_uuid][dsn] = datasets[dsn];
            };

            var zpsplit = common.splitPath(vm.config.zonepath);
            var zone_dset_name = zpsplit.join(path.sep);
            var cores_dset_name = path.join(zpsplit[0], 'cores', vm_uuid);

            for (var dataset_name in datasets) {
                if (jsprim.startsWith(dataset_name, zone_dset_name)) {
                    add(dataset_name);
                } else if (jsprim.startsWith(dataset_name, cores_dset_name)) {
                    add(dataset_name);
                }
            }
        }
        callback();
    });
}


module.exports = {
    getVirtualMachineUsage: getVirtualMachineUsage
};
/* vim: set ts=4 sts=4 sw=4 et: */
