/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_assert = require('assert');
var mod_path = require('path');
var mod_fs = require('fs');
var mod_util = require('util');
var mod_stream = require('stream');
var mod_events = require('events');
var mod_vasync = require('vasync');
var mod_extsprintf = require('extsprintf');
var mod_mkdirp = require('mkdirp');

var MODE_DIR = parseInt('0750', 8);
var MODE_FILE = parseInt('0640', 8);

function get_hour(dt) {
    var t = new Date(dt);

    t.setUTCMilliseconds(0);
    t.setUTCSeconds(0);

    /*
     * We want to include 00:01:00 --> 01:00:00
     * in the file called T00...
     */
    if (t.getUTCMinutes() === 0)
        t.setUTCHours(t.getUTCHours() - 1);

    t.setUTCMinutes(0);

    return (t);
}

function make_filename(basedir, dt) {
    var h = get_hour(dt);
    var sfx = mod_extsprintf.sprintf('%04d-%02d-%02dT%02d.log',
        h.getUTCFullYear(),
        h.getUTCMonth() + 1,
        h.getUTCDate(),
        h.getUTCHours());
    return (mod_path.join(basedir, sfx));
}

function UsageFileWriter(basedir, dt) {
    var self = this;
    mod_events.EventEmitter.call(this);

    self.ufw_ended = false;
    self.ufw_end_cb = null;

    self.ufw_fd = -1;
    self.ufw_path = make_filename(basedir, dt);

    /*
     * Service queue:
     */
    self.ufw_q = mod_vasync.queuev({
        worker: function (task, next) {
            self.ufw_out.write(JSON.stringify(task.t_record) + '\n',
              function () {
                next();
            });
        },
        concurrency: 1
    });
    self.ufw_q.on('end', function () {
        mod_assert.ok(self.ufw_end_cb);
        mod_assert.ok(self.ufw_fd !== -1);

        mod_fs.fsync(self.ufw_fd, function (err) {
            self.ufw_out.on('finish', function () {
                if (err)
                    self.emit('error', err);
                self.ufw_end_cb();
            });
            /*
             * Close the output stream:
             */
            self.ufw_out.end();
        });
    });

    /*
     * Open the usage file for append:
     */
    mod_mkdirp.sync(mod_path.dirname(self.ufw_path), MODE_DIR);
    self.ufw_out = mod_fs.createWriteStream(self.ufw_path, {
        flags: 'a',
        encoding: 'utf8',
        mode: MODE_FILE
    });
    self.ufw_out.once('open', function (fd) {
        /*
         * Stash the file descriptor, so that we may fsync(2) later.
         */
        self.ufw_fd = fd;

        /*
         * If we have already ended, then close the queue immediately.  This
         * will trigger the fsync() and file closure.
         */
        if (self.ufw_ended)
            self.ufw_q.close();
    });

    /*
     * In case we're appending after a previous (but incomplete) record, start
     * by writing a newline.  We'll discard blank (or even unparseable) lines
     * while reading the file later.
     */
    self.ufw_out.write('\n');
}
mod_util.inherits(UsageFileWriter, mod_events.EventEmitter);

UsageFileWriter.prototype.write = function (record, callback) {
    var self = this;

    mod_assert.ok(!self.ufw_ended, 'write() after end()');

    self.ufw_q.push({
        t_record: record
    }, callback);
};

UsageFileWriter.prototype.end = function (callback) {
    var self = this;

    mod_assert.ok(!self.ufw_ended, 'already called end()');
    self.ufw_ended = true;
    self.ufw_end_cb = callback;

    /*
     * If we've been opened, and thus have a file descriptor, then
     * signal the closing of the queue:
     */
    if (self.ufw_fd !== -1)
        self.ufw_q.close();
};


module.exports = {
    UsageFileWriter: UsageFileWriter
};
/* vim: set ts=4 sts=4 sw=4 et: */
