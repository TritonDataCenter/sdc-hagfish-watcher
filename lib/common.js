/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * This file defines the object responsible for emitting periodic updates of
 * current VM usage information.
 */

var kstat = require('kstat');
var fs = require('fs');

/*
 * Generate random 4 byte strings of hexadecimal characters.
 */

function genId() {
    return Math.floor(Math.random() * 0xffffffff).toString(16);
}


/**
 * Join array of strings with a 'period'.
 */

function dotjoin() {
    return Array.prototype.join.call(arguments, '.');
}


/**
 * Return the boot timestemp of a VM.
 */

function bootTime(cb) {
    var reader = new kstat.Reader({
        module: 'unix',
        instance: 0,
        name: 'system_misc'
    });
    var stats = reader.read();
    cb(null, stats[0].data.boot_time);
}


function loadConfig(filename, callback) {
    fs.readFile(filename, function (error, data) {
        if (error) {
            callback(error);
            return;
        }
        callback(error, JSON.parse(data.toString()));
        return;
    });
}


module.exports = {
    dotjoin: dotjoin,
    genId: genId,
    bootTime: bootTime,
    loadConfig: loadConfig
};
