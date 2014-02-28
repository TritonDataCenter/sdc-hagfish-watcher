/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This file defines the object responsible for emitting periodic updates of
 * current VM usage information.
 */

var util = require('util');
var events = require('events');
var zutil = require('zutil');
var async = require('async');
var common = require('./common');
var kstat = require('kstat');
var zfs = require('zfs').zfs;
var vasync = require('vasync');
var jsprim = require('jsprim');
var verror = require('verror');
var assert = require('assert-plus');



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
        vmDatasetsToPath: {}
    };

    vasync.pipeline({
        funcs: [
            updateNetworkUsage,
            updateVirtualMachines,
            updateDisk,
            transform
        ],
        arg: watcher_state
    }, function (err) {
        if (err) {
            log.error({
                err: err,
                runtime: Date.now() - start
            }, 'could not enumerate virtual machines');
            callback(err);
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
        setImmediate(function () {
            callback(err || null);
        });
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

    var endfn = function (err) {
        if (callback) {
            callback(err);
            callback = null;
        }
    };

    var q = vasync.queuev({
        worker: updateVirtualMachineWorker,
        concurrency: 16
    });
    q.on('end', endfn);

    /*
     * Get the list of VMs and queue up the fetch:
     */
    common.vmListFromFile(function (err, vms) {
        if (err) {
            endfn(err);
            return;
        }

        for (var i = 0; i < vms.length; i++) {
            var vm = vms[i];
            q.push({
                ws: ws,
                vm: vm
            }, endfn);
        }
        q.close();
    });
}


function updateNetworkUsage(ws, callback) {
    assert.object(ws);
    assert.func(callback);

    var bootTimestamp;
    var usage = {};

    async.waterfall([
        common.bootTime,
        function (time, cb) {
            bootTimestamp = time;
            cb();
        },
        function (cb) {
            var reader = new kstat.Reader({ module: 'link' });
            var stats = reader.read();
            var i = stats.length;
            var zoneRE = /z(\d+)_(.*)/;

            while (i--) {
                var link = stats[i];
                var m = link.name.match(zoneRE);

                if (!m) {
                    continue;
                }

                var zoneid = m[1];
                var linkname = m[2];
                var zonename = zutil.getZoneById(Number(zoneid)).name;

                if (!usage[zonename]) {
                    usage[zonename] = {};
                }

                if (!usage[zonename][linkname]) {
                    usage[zonename][linkname] = {};
                }

                var counter_start = new Date(
                    bootTimestamp * 1000 + Number(link.crtime) / 1000000000.0)
                    .toISOString();

                usage[zonename][linkname] = {
                    sent_bytes: link.data.obytes64,
                    received_bytes: link.data.rbytes64,
                    counter_start: counter_start
                };
            }

            return cb();
        }
    ],
    function (error) {
        if (error) {
            callback(error);
            return;
        }
        ws.network = usage;
        callback();
    });
}


function updateDisk(ws, callback) {
    assert.object(ws);
    assert.func(callback);

    var datasets = {};

    async.waterfall([
        function (cb) {
            zfs.get(
                null, // Look up properties for *all* datasets
                ['name', 'used', 'available', 'referenced', 'type',
                 'mountpoint', 'quota', 'origin', 'volsize', 'creation'],
                true, // Parseable
                function (geterr, props) {
                    if (geterr) {
                        cb(geterr);
                        return;
                    }
                    datasets = props;
                    cb();
                });
        },
        function (cb) {
            var numKeys = ['used', 'available', 'referenced', 'quota',
                'volsize', 'creation'];
            // For each vm:
            //    Find all datasets which match the zonepath
            //    Find all datasets for cores
            //    For all found datasets, include properties for those datasets
            async.each(
                Object.keys(ws.vms),
                function (uuid, ecb) {
                    var vm = ws.vms[uuid];
                    if (!ws.disk[uuid]) {
                        ws.disk[uuid] = {};
                    }

                    function add(ds) {
                        ws.disk[uuid][ds] = datasets[ds];

                        for (var k in ws.disk[uuid][ds]) {
                            if (ws.disk[uuid][ds][k] !== '-' &&
                              numKeys.indexOf(k) !== -1) {
                                ws.disk[uuid][ds][k] =
                                  parseInt(ws.disk[uuid][ds][k], 10);
                            }
                        }
                    }

                    for (var d in datasets) {
                        var zonepath = vm.config.zonepath.slice(1);
                        var pool = zonepath.slice(0, zonepath.indexOf('/'));

                        if (jsprim.startsWith(d, zonepath)) {
                            add(d);
                        }
                        if (jsprim.startsWith(d, pool + '/cores/' + vm.uuid)) {
                            add(d);
                        }
                    }
                    ecb();
                },
                function (err) {
                    cb();
                });
        }
    ],
    function () {
        callback();
    });
}


module.exports = {
    getVirtualMachineUsage: getVirtualMachineUsage
};
/* vim: set ts=4 sts=4 sw=4 et: */
