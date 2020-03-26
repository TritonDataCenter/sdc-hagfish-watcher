/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_path = require('path');
var mod_fs = require('fs');
var mod_child = require('child_process');
var mod_events = require('events');
var mod_util = require('util');

var lib_common = require('./common');
var lib_gzip = require('./gzip');

function shouldGzip(filename) {
    var thishour = lib_common.alignDateToHour(new Date()).valueOf();
    var filehour = lib_common.parseUsageFileName(filename).valueOf();

    /*
     * The file name was not a valid date stamp:
     */
    if (!filehour)
        return (false);

    /*
     * If the file is for the current, or a future hour, skip it for now:
     */
    if (filehour >= thishour)
        return (false);

    return (true);
}

function GzipService(log, dirname) {
    var self = this;
    mod_events.EventEmitter.call(self);

    self.gs_log = log.child({
        component: 'GzipService'
    });
    self.gs_dirname = dirname;
    self.gs_running = false;
    self.gs_queued = false;
    self.gs_ents = null;
}
mod_util.inherits(GzipService, mod_events.EventEmitter);

GzipService.prototype.trigger = function (doWrite) {
    var self = this;

    if (!doWrite) {
        return;
    }

    if (self.gs_running) {
        self.gs_queued = true;
        return;
    }
    self.gs_running = true;

    self.gs_log.debug('triggered');

    self._resched();
};

GzipService.prototype._resched = function () {
    var self = this;

    setImmediate(function () {
        self._work();
    });
};

GzipService.prototype._work = function () {
    var self = this;

    if (self.gs_ents === null) {
        /*
         * Read the directory:
         */
        mod_fs.readdir(self.gs_dirname, function (err, ents) {
            if (err) {
                self.gs_running = false;
                self.gs_queued = false;
                self.emit('error', err);
                return;
            }

            self.gs_ents = ents;
            self._resched();
        });
        return;
    }

    if (self.gs_ents.length < 1) {
        /*
         * Iteration complete.  If we're queued up, run again:
         */
        self.gs_ents = null;
        self.gs_running = false;
        self.gs_log.debug('run complete');
        if (self.gs_queued) {
            self.gs_log.debug('queued, rescheduling immediately');
            self.gs_queued = false;
            self.trigger(true);
        }
        return;
    }

    var ent = self.gs_ents.pop();
    if (!shouldGzip(ent)) {
        self.gs_log.trace({
            filename: ent
        }, 'should not gzip file');
        self._resched();
        return;
    }

    self.gs_log.info({
        filename: ent
    }, 'gzipping file');
    lib_gzip.safeGzip(self.gs_log, mod_path.join(self.gs_dirname, ent),
      function (err) {
        if (err) {
            self.gs_log.error({
                err: err
            }, 'gzip error');
            self.emit('error', err);
            return;
        }

        self._resched();
    });
};

module.exports = {
    GzipService: GzipService
};
/* vim: set ts=4 sts=4 sw=4 et: */
