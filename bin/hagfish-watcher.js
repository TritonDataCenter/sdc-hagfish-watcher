/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This is the entry point to the hagfish usage watcher service.
 */

var mod_bunyan = require('bunyan');
var mod_path = require('path');
var mod_mkdirp = require('mkdirp');
var mod_verror = require('verror');

var lib_common = require('../lib/common');
var lib_service = require('../lib/service');

var configFilename = mod_path.join(__dirname, '..', 'config', 'config.json');
lib_common.loadConfig(configFilename, function (error, config) {
    if (error) {
        throw (new mod_verror.VError(error, 'could not load config'));
    }

    config.log = mod_bunyan.createLogger({
        name: 'hagfish-watcher',
        level: process.env.LOG_LEVEL || config.logLevel || 'info',
        serializers: mod_bunyan.stdSerializers
    });

    /*
     * Create the usage log directory if it does not exist:
     */
    mod_mkdirp.sync(config.usageLogDirectory, 0750);

    var service = new lib_service.Service(config);
    service.start();

    config.log.info('startup complete');
});
