/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file forms the core of the hagfish-watcher service. It is responsible
 * for starting the watcher and ensuring any events emitted are recorded to
 * disk.
 */

var Watcher = require('./watcher');
var mkdirp = require('mkdirp');

function Service(config) {
    config = config || {};

    this.log = config.log;
    this.usageLogDirectory = config.usageLogDirectory || '/var/run/sdc-usage';
    this.watcher = new Watcher({
        log: this.log,
        intervalSeconds: config.intervalSeconds
    });
}


Service.prototype.start = function (callback) {
    var self = this;

    this.watcher.on('vm-update', function (update) {
        self.log.info({ vm: update }, 'Got a VM Update');
    });
    this.watcher.on('net-update', function (update) {
        self.log.info({ vm: update }, 'Got a net update');
    });

    this.watcher.start();
};

module.exports = Service;
