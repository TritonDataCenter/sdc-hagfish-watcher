/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This is the entry point to the hagfish usage watcher service.
 */

var mod_bunyan = require('bunyan');
var mod_path = require('path');
var mod_mkdirp = require('mkdirp');
var mod_verror = require('verror');

var lib_common = require('../lib/common');
var lib_service = require('../lib/service');

var MODE_DIR = parseInt('0750', 8);

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
    mod_mkdirp.sync(config.usageLogDirectory, MODE_DIR);

    var service = new lib_service.Service(config);
    service.start();

    config.log.info('startup complete');
});

/* vim: set ts=4 sts=4 sw=4 et: */
