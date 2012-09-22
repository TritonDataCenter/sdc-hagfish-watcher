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

var Zone = require('tracker/lib/zone');
var Monitor = require('tracker/lib/monitor');

function Watcher(config) {
    events.EventEmitter.call(this);

    this.config = config;
    this.log = config.log;

    this.config.intervalSeconds = this.config.intervalSeconds || 60;

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
    self.startPeriodicUpdates();
//    self.startMonitoringChanges();
};


Watcher.prototype.startMonitoringChanges = function () {
    var self = this;
    self.monitor = Monitor.create();

    self.monitor.on('event', self.onConfigurationEvent.bind(self));
    self.monitor.start();
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
            self.gatherStateAllZones();
        }, dsecs * 1000);
    }

    scheduleConfigurationCheck();
};


Watcher.prototype.gatherStateAllZones = function (callback) {
    var self = this;
    async.waterfall([
        function (cb) {
            self.updateNetworkUsage(cb);
        },
        function (cb) {
            self.updateVirtualMachines(cb);
        },
        function (cb) {
            self.transform(cb);
        },
        function (vms, cb) {
            for (var v in vms) {
                self.emit('vm-update', vms[v]);
            }
        }
    ],
    function (err) {
        self.log.debug('Done emitting');
    });
};


Watcher.prototype.transform = function (callback) {
    var self = this;
    var vms = {};

    async.forEach(
        Object.keys(self.vms),
        function (vm, cb) {
            self.transformVm(self.vms[vm], function (err, vm) {
                vms[vm.uuid] = vm;
                cb();
            });
        },
        function (err) {
            callback(null, vms);
        });
}

Watcher.prototype.transformVm = function (vmObj, callback) {
    var self = this;

    var vm = {};

    vm.zonename = vmObj.config.name;
    vm.zonepath = vmObj.config.zonepath;
    vm.uuid = vmObj.config.name;
    vm.os_uuid = vmObj.os_uuid;
    vm.status = vmObj.status;
    vm.config = JSON.parse(JSON.stringify(vmObj.config));
    vm.network_usage = self.usage[vm.uuid];
    vm.v = '1';

    callback(null, vm);
}


Watcher.prototype.updateVirtualMachines = function (callback) {
    var self = this;
    Zone.listFromFile(function (error, vms) {
        async.forEach(
            vms,
            onVm,
            function () {
                self.log.debug('Done updating');
                callback();
            });
    });

    function onVm(z, cb) {
        if (z.name === 'global') {
            cb();
            return;
        }

        var vm = self.vms[z.name] = {};
        vm.uuid = z.name;
        vm.os_uuid = z.uuid;

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

        Zone.get(vm.uuid, function (error, vmrec) {
            if (error) {
                callback(error);
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
    }
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
        self.usage = usage;
        callback();
    });
};


Watcher.prototype.updateDiskUsage = 


module.exports = Watcher;
