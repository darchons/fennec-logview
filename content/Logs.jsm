/* This Source Code Form is subject to the terms of the Mozilla Public
 *  * License, v. 2.0. If a copy of the MPL was not distributed with this
 *   * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [ "Logs" ];

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const MAX_LOGS = 1000;
const LOG_PRIORITY = "??VDIWEF";

var gWorker = null;
var gLogs = [];
var gListeners = [];

const HANDLERS = {
  "log": function (message) {
    var log = message.log;
    if (gLogs.length >= 2 * MAX_LOGS) {
      gLogs.splice(0, gLogs.length - MAX_LOGS + 1);
    } else if (gLogs.length >= MAX_LOGS) {
      delete gLogs[gLogs.length - MAX_LOGS];
    }
    gLogs.push(log);

    for (let i = 0; i < gListeners.length; i++) {
      if (!gListeners[i](log)) {
        // Remove listener if it returns false.
        gListeners.splice(i--, 1);
      }
    }
  }
};

this.Logs = {

  LOG_VERBOSE: 2,
  LOG_DEBUG: 3,
  LOG_INFO: 4,
  LOG_WARN: 5,
  LOG_ERROR: 6,
  LOG_FATAL: 7,

  getPriorityLabel: function(priority) {
    if (priority >= LOG_PRIORITY.length) {
      return "?";
    }
    return LOG_PRIORITY.charAt(priority);
  },

  init: function() {
    if (gWorker) {
      return;
    }

    gWorker = new ChromeWorker("chrome://logview/content/worker.js");

    gWorker.addEventListener("message", (event) => {
      let message = event.data;

      if (message.type in HANDLERS) {
        return HANDLERS[message.type](message);
      }
      throw new Error("invalid message type: " + message.type);

    }, false);

    gWorker.postMessage({
      type: "start",
      file: "/dev/log/main",
    });
  },

  dump: function(fn) {
    for (let log of gLogs) {
      if (!log) {
        continue;
      }
      if (!fn(log)) {
        return false;
      }
    }
    return true;
  },

  listen: function(fn) {
    if (gListeners.indexOf(fn) >= 0) {
      return;
    }
    if (this.dump(fn)) {
      gListeners.push(fn);
    }
  },

  unlisten: function(fn) {
    let index = gListeners.indexOf(fn);
    if (index >= 0) {
      gListeners.splice(index, 1);
    }
  },

  term: function() {
    if (!gWorker) {
      return;
    }

    gWorker.postMessage({
      type: "end",
    });
    gWorker = null;
  },
};
