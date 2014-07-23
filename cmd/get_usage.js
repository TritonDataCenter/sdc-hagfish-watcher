/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 */

var mod_bunyan = require('bunyan');

var lib_common = require('../lib/common');
var lib_usage = require('../lib/usage');

var LOG = mod_bunyan.createLogger({
    name: 'get_usage',
    level: process.env.LOG_LEVEL || 'info',
    serializers: mod_bunyan.stdSerializers,
    stream: process.stderr
});

var NOW;
var SYSINFO;

var ARGV = process.argv.slice(2);

function
fetch_sysinfo(callback)
{
    lib_common.sysinfo(function (err, sysinfo) {
        if (err) {
            LOG.error(err, 'could not fetch sysinfo');
            process.exit(1);
            return;
        }

        SYSINFO = sysinfo;
        setImmediate(callback);
    });
}

function
process_usage(err, vms, summary)
{
    if (err) {
        LOG.error(err, 'could not get usage');
        process.exit(1);
        return;
    }

    /*
     * Emit linefeed-separated JSON-formatted VM usage records to
     * stdout:
     */
    var found = false;
    for (var i = 0; i < vms.length; i++) {
        var vm = vms[i];

        if (!ARGV[0] || ARGV[0] === vm.uuid) {
            found = true;
            process.stdout.write(JSON.stringify(vms[i]) + '\n');
        }
    }
    if (ARGV[0] && !found) {
        LOG.error('no matching VM!');
    }

    LOG.info(summary, 'summary');

    process.exit(0);
}

/*
 * Entry point:
 */

fetch_sysinfo(function () {
    NOW = new Date();

    var base = {
        sdc_version: SYSINFO['SDC Version'] || '6.5',
        server_uuid: SYSINFO['UUID'],
        datacenter_name: SYSINFO['Datacenter Name']
    };

    var log = LOG.child({
        component: 'lib_usage'
    });

    lib_usage.getVirtualMachineUsage(NOW, base, log, process_usage);
});

/* vim: set ts=4 sts=4 sw=4 et: */
