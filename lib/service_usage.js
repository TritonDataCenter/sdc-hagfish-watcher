/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 * Copyright 2023 Spearhead Systems SRL.
 */

var mod_path = require('path');
var mod_fs = require('fs');
var mod_child = require('child_process');
var mod_events = require('events');
var mod_util = require('util');

var lib_ufw = require('./ufw');
var lib_usage = require('./usage');
var lib_common = require('./common');

function UsageService(log, dirname) {
    var self = this;
    mod_events.EventEmitter.call(self);

    self.us_log = log.child({
        component: 'UsageService'
    });
    self.us_dirname = dirname;
    self.us_running = false;

    self.us_vm_cache = {};

    self.us_base_record = null;

    lib_common.sysinfo(function (err, sysinfo) {
        if (err) {
            self.emit('error', err);
            return;
        }

        self.us_base_record = {
            sdc_version: sysinfo['SDC Version'] || '6.5',
            server_uuid: sysinfo['UUID'],
            datacenter_name: sysinfo['Datacenter Name']
        };
    });
}
mod_util.inherits(UsageService, mod_events.EventEmitter);

UsageService.prototype.trigger = function (doWrite) {
    var self = this;

    if (!self.us_base_record) {
        /*
         * Can't run until we have fetched the base record from sysinfo:
         */
        return;
    }

    if (self.us_running)
        return;
    self.us_running = true;

    self.us_log.debug('triggered');

    self._resched(doWrite);
};

UsageService.prototype._resched = function (doWrite) {
    var self = this;

    setImmediate(function () {
        self._work(doWrite);
    });
};

UsageService.prototype._work = function (doWrite) {
    var self = this;

    var now = new Date();

    lib_usage.getVirtualMachineUsage(now, self.us_base_record, self.us_log,
      function (err, vms, summary) {
        if (err) {
            self.us_log.fatal({
                err: err,
                vms: vms,
                summary: summary
            }, 'getVirtualMachineUsage returned error');
            throw (err);
        }

        /*
         * Update cache every _work() call.
         */
        vms.forEach(function updateVm(_vm) {
            self.us_vm_cache[_vm.uuid] = _vm;
        });

        /*
         * If we're not writing, updating the cache was enough.
         */
        if (!doWrite) {
            self.us_running = false;
            self.us_log.debug({
                summary: summary
            }, 'caching run complete');

            return;
        }

        /*
         * Replace vms with the updated cache, then empty cache.
         */
        vms = Object.keys(self.us_vm_cache).map(function getVm(vmUuid) {
            return self.us_vm_cache[vmUuid];
        });
        self.us_vm_cache = {};

        var ufw = new lib_ufw.UsageFileWriter(self.us_dirname, now);
        ufw.on('error', function (_err) {
            self.us_log.fatal({
                err: _err,
                vms: vms,
                summary: summary
            }, 'UsageFileWriter returned error');
            throw (_err);
        });

        for (var i = 0; i < vms.length; i++) {
            var vm = vms[i];
            ufw.write(vm);
        }
        ufw.write(summary);
        ufw.end(function () {
            /*
             * We're no longer running once we've flushed the entire
             * usage record set to disk.
             */
            self.us_running = false;
            self.us_log.debug({
                summary: summary
            }, 'run complete');
        });
    });
};

module.exports = {
    UsageService: UsageService
};
/* vim: set ts=4 sts=4 sw=4 et: */
