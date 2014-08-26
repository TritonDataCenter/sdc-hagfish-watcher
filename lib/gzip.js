/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_assert = require('assert-plus');
var mod_path = require('path');
var mod_fs = require('fs');
var mod_child = require('child_process');
var mod_vasync = require('vasync');
var mod_verror = require('verror');

function syncDirectory(dirname) {
    mod_assert.string(dirname);

    var fd = mod_fs.openSync(dirname, 'r');
    mod_fs.fsyncSync(fd);
    mod_fs.closeSync(fd);
}

function safeGzip(log, pathname, callback) {
    mod_assert.object(log);
    mod_assert.string(pathname);
    mod_assert.func(callback);

    var gzname = pathname + '.gz';
    var tmpname = mod_path.join(mod_path.dirname(gzname),
      '.' + mod_path.basename(gzname));

    if (mod_fs.existsSync(gzname)) {
        /*
         * We already gzipped this file, so delete the original.
         */
        log.info({
            filename: gzname
        }, 'gzipped file exists already; unlinking original');
        try {
            mod_fs.unlinkSync(pathname);
        } catch (ex) {
            log.error({
                err: new mod_verror.VError(ex),
                filename: pathname
            }, 'error unlinking file');
        }
        setImmediate(callback);
        return;
    }

    /*
     * Read from source file:
     */
    var fin = mod_fs.createReadStream(pathname);

    /*
     * Write to a temporary file, saving the fd so that we may
     * fsync(2) it before close:
     */
    var foutfd = -1;
    var fout = mod_fs.createWriteStream(tmpname);
    fout.on('open', function (fd) {
        log.debug({
            fd: fd,
            filename: tmpname
        }, 'tmpfile opened');
        foutfd = fd;
    });

    var b = mod_vasync.barrier();
    b.on('drain', function () {
        /*
         * Rename the temporary file to its destination name:
         */
        mod_fs.renameSync(tmpname, gzname);

        /*
         * Ensure the new link has been written to disk, and then delete the
         * original:
         */
        syncDirectory(mod_path.dirname(gzname));
        mod_fs.unlinkSync(pathname);

        callback();
    });

    /*
     * Fork a child process to do the compression:
     */
    b.start('gzip process');
    var gzip = mod_child.spawn('gzip');
    log.debug({
        pid: gzip.pid
    }, 'spawned process');

    /*
     * Read from the input file and pipe in to gzip:
     */
    fin.pipe(gzip.stdin);

    /*
     * Store the gzip stream in the temporary output file:
     */
    b.start('gzip stdout');
    gzip.stdout.on('readable', function () {
        var buf = gzip.stdout.read();
        if (!buf)
            return;
        fout.write(buf);
    });
    gzip.stdout.on('end', function () {
        /*
         * Ensure the contents of the temporary file are flushed to disk:
         */
        mod_fs.fsyncSync(foutfd);
        fout.end();
        b.done('gzip stdout');
    });

    /*
     * Ensure the gzip process completed without error:
     */
    gzip.on('close', function (code, signal) {
        log.debug({
            code: code,
            signal: signal
        }, 'gzip exited');
        if (code !== 0) {
            callback(new Error('gzip failed code ' + code + ' signal ' +
              signal));
            return;
        }
        b.done('gzip process');
    });
}

module.exports = {
    safeGzip: safeGzip
};
/* vim: set ts=4 sts=4 sw=4 et: */
