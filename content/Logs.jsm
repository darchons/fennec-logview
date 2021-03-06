/* This Source Code Form is subject to the terms of the Mozilla Public
 *  * License, v. 2.0. If a copy of the MPL was not distributed with this
 *   * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [ "Logs" ];

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const LOG_PRIORITY = "??VDIWEF";
const LOG_LIMIT = 500;

var gWorker = null;
var gLogs = new Array(LOG_LIMIT);
var gLogsPtr = 0;
var gListeners = [];

const HANDLERS = {
  "log": function (message) {
    var log = message.log;

    for (let i = 0; i < gListeners.length; i++) {
      if (gListeners[i](log) === false) {
        // Remove listener if it returns false.
        gListeners.splice(i--, 1);
      }
    }

    while (gLogsPtr >= gLogs.length) {
      gLogsPtr -= gLogs.length;
    }
    gLogs[gLogsPtr++] = log;
  }
};

this.Logs = {

  LOG_LIMIT: LOG_LIMIT,

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
    for (let i = gLogsPtr; i < gLogs.length; ++i) {
      let log = gLogs[i];
      if (log && fn(log) === false) {
        return false;
      }
    }
    for (let i = 0; i < gLogsPtr; ++i) {
      if (fn(gLogs[i]) === false) {
        return false;
      }
    }
    return true;
  },

  listen: function(fn) {
    if (gListeners.indexOf(fn) >= 0) {
      return;
    }
    gListeners.push(fn);
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
