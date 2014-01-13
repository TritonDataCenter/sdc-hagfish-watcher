/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file forms the core of the hagfish-watcher service. It is responsible
 * for starting the watcher and ensuring any events emitted are recorded to
 * disk.
 */

var Watcher = require('./watcher');
var mkdirp = require('mkdirp');
var path = require('path');
var async = require('async');
var common = require('./common');
var execFile = require('child_process').execFile;
var fs = require('fs');
var sprintf = require('sprintf').sprintf;

function Service(config) {
    config = config || {};

    this.log = config.log;
    this.usageLogDirectory = config.usageLogDirectory || '/var/log/usage';
    this.rotateIntervalSeconds = config.rotateIntervalSeconds || 60 * 60;
    this.intervalSeconds = config.intervalSeconds || 20;
}


Service.prototype.start = function (callback) {
    var self = this;

    var startTime;
    var templatefn;
    var templatedir;
    var sysinfo;

    var queue = [];
    async.waterfall([
        function (cb) {
            common.sysinfo(function (err, s) {
                if (err) {
                    cb(err);
                    return;
                }
                sysinfo = s;
                cb();
            });
        },
        function (cb) {
            mkdirp(self.usageLogDirectory, function (mkdirperror) {
                if (mkdirperror) {
                    self.log.error(mkdirperror, 'mkdirp error');
                    cb();
                    return;
                }
                cb();
            });
        },
        function (cb) {
            self.watcher = new Watcher({
                log: self.log,
                intervalSeconds: self.intervalSeconds,
                include: {
                    sdc_version: sysinfo['SDC Version'] || '6.5',
                    server_uuid: sysinfo['UUID'],
                    datacenter_name: sysinfo['Datacenter Name']
                }
            });
            cb();
        }
    ],
    function (error) {
        if (error) {
            self.log.error(error);
            return;
        }
        // Create thew WriteStream
        self.usageStream = fs.createWriteStream(
            self.usageLogDirectory + '/usage.log',
            { flags: 'a', mode: parseInt('0744', 8) });

        self.usageStream.on('open', function () {
            startTime = new Date();
            updateLogFilename();

            scheduleRotate();

            var update_func = function (update) {
                queue.push(update);
                write();
            };
            self.watcher.on('vm-update', update_func);
            self.watcher.on('vm-summary', update_func);

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

    function updateLogFilename() {
        templatedir = path.join(
            self.usageLogDirectory,
            String(startTime.getUTCFullYear()),
            sprintf('%02d', startTime.getUTCMonth()+1),
            sprintf('%02d', startTime.getUTCDate()));

        templatefn = sprintf(
            '%s/%s.%s.log',
            templatedir,
            sysinfo['UUID'],
            smallts(startTime));
    }

    function scheduleRotate() {
        // To avoid drift, schedule our rotations to happen on the
        // hour.
        var d = new Date();
        var min = 59 - d.getUTCMinutes();
        var sec = 59 - d.getUTCSeconds();
        var wait = 60 * min + sec + 5;

        self.log.info(
            'Rotating in %dm %ds (%ds) ' +
            'to %s',
            min, sec, wait,
            templatefn);

        setTimeout(function () {
            rotate();
        }, wait * 1000);
    }

    function rotate() {
        var fn = templatefn;
        execFile(
            '/usr/sbin/logadm',
            ['-c', '-z', '0', '-t',
            fn,
            self.usageLogDirectory + '/usage.log'],
            function (error, stdout, stderr) {
                if (error) {
                    self.log.error(error, 'Error rotating file');
                }
                startTime = new Date();

                updateLogFilename();
                self.log.info('Rotated usage to %s', fn);

                scheduleRotate();
            });
    }
};

function smallts(date) {
    return date.toISOString().replace(/[:-]/g, '').replace(/\..*$/, '');
}

module.exports = Service;
