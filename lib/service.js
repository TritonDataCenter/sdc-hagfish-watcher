/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 * Copyright 2023 Spearhead Systems SRL.
 */

var mod_assert = require('assert-plus');
var mod_events = require('events');
var mod_util = require('util');

var lib_common = require('./common');

var GzipService = require('./service_gzip').GzipService;
var UsageService = require('./service_usage').UsageService;


function Service(config) {
    var self = this;
    mod_events.EventEmitter.call(self);

    mod_assert.object(config, 'config');
    mod_assert.string(config.usageLogDirectory, 'config.usageLogDirectory');

    self.s_log = config.log;
    self.s_usagedir = config.usageLogDirectory;

    self.s_started = false;
    self.s_services = [
        {
            srv_service: new GzipService(self.s_log, self.s_usagedir),
            srv_hours: '*',
            srv_minutes: 2,
            srv_at_startup: true
        },
        {
            srv_service: new UsageService(self.s_log, self.s_usagedir),
            srv_hours: '*',
            srv_minutes: '*',
            srv_at_startup: false
        }
    ];
}
mod_util.inherits(Service, mod_events.EventEmitter);

Service.prototype._trigger = function (hour, minute, doWrite) {
    var self = this;

    for (var i = 0; i < self.s_services.length; i++) {
        var srv = self.s_services[i];

        if (hour === false && minute === false) {
            if (!srv.srv_at_startup)
                continue;
        } else {
            if (srv.srv_hours !== '*' && srv.srv_hours !== hour)
                continue;

            if (srv.srv_minutes !== '*' && srv.srv_minutes !== minute)
                continue;
        }

        srv.srv_service.trigger(doWrite);
    }
};

Service.prototype._resched = function () {
    var self = this;

    var dt = new Date();
    dt.setUTCMilliseconds(0);
    /*
     * Advance to the next check, which happens four times per minute:
     */
    do {
        dt.setUTCSeconds(dt.getUTCSeconds() + 1);
    } while (dt.getUTCSeconds() % 15 !== 0);

    /*
     * Although we check four times a minute, we only write out the accumulated
     * results once a minute.
     */
    var writeOut = (dt.getUTCSeconds() === 0);

    setTimeout(function () {
        var dtt = new Date();
        self._trigger(dtt.getUTCHours(), dtt.getUTCMinutes(), writeOut);
        self._resched();
    }, dt.valueOf() - Date.now());
};

Service.prototype.start = function () {
    var self = this;

    if (self.s_started)
        return;
    self.s_started = true;

    /*
     * Run tasks that should fire once at startup:
     */
    setImmediate(function () {
        self._trigger(false, false, true);
    });
    /*
     * Schedule first periodic execution:
     */
    self._resched();
};

module.exports = {
    Service: Service
};
/* vim: set ts=4 sts=4 sw=4 et: */
