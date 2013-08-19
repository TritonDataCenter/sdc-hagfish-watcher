/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
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
var Monitor = require('./monitor');
var zfs = require('zfs').zfs;

function Watcher(config) {
    events.EventEmitter.call(this);

    this.config = config;
    this.log = config.log;

    this.config.intervalSeconds = this.config.intervalSeconds || 60;
    this.include = config.include || {};

    this.vmPathsToZone = {};
    this.vmPathsToDataset = {};
    this.vmsToDataset = {};
    this.vmDatasetsToPath = {};

    this.intervals = {};
    this.timers = {};

    this.vms = {};
    this.network = {};
    this.disk = {};
}

util.inherits(Watcher, events.EventEmitter);


/*
 * Start watching for VM changes on the server, and periodically emitting a
 * updates which present a complete picture of the state of VMs on the server.
 */

Watcher.prototype.start = function (callback) {
    var self = this;
    self.startMonitoring();
    self.startPeriodicUpdates();
};


Watcher.prototype.startPeriodicUpdates = function () {
    var self = this;

    var configurationScheduledSeconds = self.config.intervalSeconds;

    function scheduleConfigurationCheck() {
        // Line up start times of intervals
        var offset = 5;
        var secs = offset + (Date.now() / 1000);
        var mod = secs % configurationScheduledSeconds;
        var dsecs = configurationScheduledSeconds - mod + offset;

        self.configurationSchedule = setTimeout(function () {
            scheduleConfigurationCheck();
            self.emitVirtualMachineState();
        }, dsecs * 1000);
    }

    scheduleConfigurationCheck();
};


Watcher.prototype.emitVirtualMachineState = function (vmuuid) {
    var self = this;

    var start = new Date();
    async.waterfall([
        function (cb) {
            self.updateNetworkUsage(cb);
        },
        function (cb) {
            self.updateVirtualMachines(cb);
        },
        function (cb) {
            self.updateDisk(cb);
        },
        function (cb) {
            self.transform(cb);
        },
        function (vms, cb) {
            var list;
            if (vmuuid) {
                list = {};
                list[vmuuid] = vms[vmuuid];
            } else {
                list = vms;
            }
            for (var v in list) {
                self.emit('vm-update', list[v]);
            }
            self.log.info('Emitted %d vm updates.', Object.keys(list).length);
            cb();
        }
    ],
    function (err) {
        if (err) {
            self.log.error(err, 'Error gathering vm states');
        }
        var end = new Date();
        self.log.info('Took %dms to produce report', (end - start));
    });
};


Watcher.prototype.transform = function (callback) {
    var self = this;
    var vms = {};

    async.each(
        Object.keys(self.vms),
        function (vm, cb) {
            self.transformVm(self.vms[vm], function (err, v) {
                vms[v.uuid] = v;
                cb();
            });
        },
        function (err) {
            callback(null, vms);
        });
};


Watcher.prototype.transformVm = function (vmObj, callback) {
    var self = this;

    var vm = JSON.parse(JSON.stringify(self.include));

    vm.timestamp = vmObj.timestamp;
    vm.zonename = vmObj.config.name;
    vm.zonepath = vmObj.config.zonepath;
    vm.uuid = vmObj.config.name;
    vm.os_uuid = vmObj.os_uuid;
    vm.status = vmObj.status;
    vm.config = JSON.parse(JSON.stringify(vmObj.config));
    vm.network_usage = self.network[vm.uuid];
    vm.disk_usage = self.disk[vm.uuid];
    vm.v = '1';

    callback(null, vm);
};


Watcher.prototype.onVmUpdate = function (z, cb) {
    var self = this;

    if (z.name === 'global') {
        cb();
        return;
    }

    var vm = self.vms[z.name] = {};
    vm.uuid = z.name;
    vm.os_uuid = z.uuid;
    vm.timestamp = (new Date()).toISOString();

    var status;
    try {
        status = zutil.getZoneState(vm.uuid);
        vm.status = status;
    }
    catch (e) {
        if (e.message.match(/no such zone configured/i)) {
            self.log.warn('Detected zone %s was destroyed', vm.uuid);
            cb();
        } else {
            throw e;
        }
    }

    common.vmGet(vm.uuid, function (error, vmrec) {
        if (error) {
            cb(error);
            return;
        }

        vm.config = vmrec;

        if (vm.config.attributes.alias) {
            vm.config.attributes.alias
                = new Buffer(vm.config.attributes.alias, 'base64')
                    .toString('utf8');
        }

        /*JSSTYLED*/
        var dataset = z.dataset.replace(/^\//, '');
        self.vmDatasetsToPath[dataset] = z.dataset;
        self.vmPathsToZone[z.dataset] = z.name;
        self.vmsToDataset[z.name] = dataset;

        cb();
    });
};


Watcher.prototype.updateVirtualMachines = function (callback) {
    var self = this;
    common.vmListFromFile(function (error, vms) {
        if (error) {
            callback(error);
            return;
        }

        async.each(
            vms,
            self.onVmUpdate.bind(self),
            function (err) {
                callback(err);
            });
    });
};


Watcher.prototype.updateNetworkUsage = function (callback) {
    var self = this;
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
        self.network = usage;
        callback();
    });
};


function startsWith(a, str) {
    return a.slice(0, str.length) === str;
}


Watcher.prototype.updateDisk = function (callback) {
    var self = this;
    var datasets = {};

    async.waterfall([
        function (cb) {
            zfs.get(
                null, // Look up properties for *all* datasets
                ['name', 'used', 'available', 'referenced', 'type',
                 'mountpoint', 'quota', 'origin', 'volsize'],
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
                'volsize'];
            // For each vm:
            //    Find all datasets which match the zonepath
            //    Find all datasets for cores
            //    For all found datasets, include properties for those datasets
            async.each(
                Object.keys(self.vms),
                function (uuid, ecb) {
                    var vm = self.vms[uuid];
                    if (!self.disk[uuid]) {
                        self.disk[uuid] = {};
                    }

                    function add(ds) {
                        self.disk[uuid][ds] = datasets[ds];

                        for (var k in self.disk[uuid][ds]) {
                            if (self.disk[uuid][ds][k] !== '-' &&
                                numKeys.indexOf(k) !== -1)
                             {
                                self.disk[uuid][ds][k]
                                    = parseInt(self.disk[uuid][ds][k], 10);
                            }
                        }
                    }

                    for (var d in datasets) {
                        var zonepath = vm.config.zonepath.slice(1);
                        var pool = zonepath.slice(0, zonepath.indexOf('/'));

                        if (startsWith(d, zonepath)) {
                            add(d);
                        }
                        if (startsWith(d, pool + '/cores/' + vm.uuid)) {
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
};


Watcher.prototype.onConfigurationEvent = function (event) {
    var self = this;
    var zonename;

    if (event.name) {
        event.zonename = event.name;
    }

    self.log.info(event, 'Received event');

    switch (event.type) {
        case 'zone_status':
            zonename = event.name;
            break;

        case 'zone_rctl':
            zonename = event.name;
            break;

        default:
            self.log.warn('Unknown event type: ' + event.type);
            break;
    }

    if (self.timers[zonename]) {
        clearTimeout(self.timers[zonename]);
        delete self.timers[zonename];
    }

    self.timers[zonename] = setTimeout(function () {
        self.emitVirtualMachineState(zonename);
    }, 2000);
};


Watcher.prototype.startMonitoring = function () {
    var self = this;
    var monitor = Monitor.create();
    monitor.on('event', self.onConfigurationEvent.bind(self));
    monitor.start({ log: self.log });
};


module.exports = Watcher;
