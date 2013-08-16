/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file forms the core of the hagfish-watcher service. It is responsible
 * for starting the watcher and ensuring any events emitted are recorded to
 * disk.
 */

var Watcher = require('./watcher');
var mkdirp = require('mkdirp');
var fs = require('fs');

function Service(config) {
    config = config || {};

    this.log = config.log;
    this.usageLogDirectory = config.usageLogDirectory || '/var/run/usage';

    this.watcher = new Watcher({
        log: this.log,
        intervalSeconds: config.intervalSeconds
    });
}


Service.prototype.start = function (callback) {
    var self = this;

    // TODO: get sysinfo -> dc_name, server_uuid, sdc_version

    var queue = [];
    mkdirp(self.usageLogDirectory, function (mkdirperror) {
        if (mkdirperror) {
            self.log.error(mkdirperror, 'mkdirp error');
            return;
        }

        self.usageStream = fs.createWriteStream(
            self.usageLogDirectory + '/usage.log',
            { flags: 'a', mode: parseInt('0755', 8) });

        self.usageStream.on('open', function () {
            self.watcher.on('vm-update', function (update) {
                self.log.info({ update: update }, 'update');
                queue.push(update);
                write();
            });
            self.watcher.start();
        });

        self.usageStream.on('error', function (err) {
            self.log.error(err, 'writeStream error');
            throw err;
        });
    });

    var writing = false;
    var drain = false;
    function write() {
        if (writing || drain) {
            return;
        }
        writing = true;
        drain = false;

        var ok;
        while (queue.length) {
            var str = queue.shift();
            ok = self.usageStream.write(JSON.stringify(str) + '\n');

            if (!ok) {
                drain = true;
                writing = false;
                self.usageStream.once('drain', function () {
                    drain = false;
                    write();
                });
                break;
            }
        }
        writing = false;
    }
};

module.exports = Service;
