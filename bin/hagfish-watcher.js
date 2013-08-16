/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This is the entry point to the hagfish usage watcher service.
 */

var bunyan = require('bunyan');
var path = require('path');
var Service = require('../lib/service');
var common = require('../lib/common');
var Logger = require('bunyan');
var sax = require('sax');
var parser = sax.parser(false);

var configFilename = path.join(__dirname, '..', 'config', 'config.json');
common.loadConfig(configFilename, function (error, config) {
    if (error) {
        throw error;
    }
    config.log = new Logger({
        name: 'hagfish-watcher',
        level: config.logLevel || 'info',
        serializers: {
            err: Logger.stdSerializers.err,
        }
    });

    var service = new Service(config);
    service.start();
});
