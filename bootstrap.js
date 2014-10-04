const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");

const PREF_ROOT = "extensions.logview.";
const PREF_PRIORITY = PREF_ROOT + "priority";
const PREF_PARSE_JS = PREF_ROOT + "parse_js";
const PREF_HIDE_CONTENT = PREF_ROOT + "hide_content";

const LOG_VERBOSE = 2;
const LOG_DEBUG = 3;
const LOG_INFO = 4;
const LOG_WARN = 5;
const LOG_ERROR = 6;
const LOG_FATAL = 7;
const LOG_PRIORITY = "??VDIWEF";

const CONSOLE_TAG = "GeckoConsole";

var gWindow = null;
var gWorker = null;
var gPrefPriority = LOG_ERROR;
var gPrefParseJS = true;
var gPrefHideContent = true;
var gLastTimestamp = Date.now();

const RE_JSCONSOLE = /^\[?(.+?):(.+?)\]?$/;
const RE_JSCONTENT = /https?:\/\//;

const HANDLERS = {
  "log": (message) => {
    let log = message.log;

    if (gPrefHideContent && log.tag === CONSOLE_TAG) {
      if (RE_JSCONTENT.test(log.message)) {
        return;
      }
    }

    if (gPrefParseJS && log.tag === CONSOLE_TAG) {
      let parts = RE_JSCONSOLE.exec(log.message.trim());
      if (parts && parts.length >= 3) {
        log.tag = parts[1].trim();
        log.message = parts[2].trim();
        if (log.tag.indexOf("Warning") >= 0) {
          log.priority = LOG_WARN;
        } else if (log.tag.indexOf("Error") >= 0) {
          log.priority = LOG_ERROR;
        } else {
          log.priority = LOG_INFO;
        }
      }
    }

    if (log.priority < gPrefPriority) {
      return;
    }

    let time = Date.now();
    if (time - gLastTimestamp < 100) {
      return;
    }
    gLastTimestamp = time;

    getWindow() && gWindow.NativeWindow.toast.show(
      LOG_PRIORITY.charAt(log.priority) + "/" + log.tag + "\n\n" + log.message, "short");
  },
};

function getWindow() {
  if (!gWindow) {
    gWindow = Services.wm.getMostRecentWindow("navigator:browser");
  }
  return gWindow;
}

function startLogview() {
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
}

function endLogview() {
  if (!gWorker) {
    return;
  }

  gWorker.postMessage({
    type: "end",
  });
  gWorker = null;
}

const OBSERVER = {
  observe: (subject, topic, data) => {
    if (topic != "nsPref:changed") {
      return;
    }

    if (data === PREF_PRIORITY) {
      try {
        gPrefPriority = Services.prefs.getIntPref(PREF_PRIORITY);
      } catch (e) {
      }
    } else if (data === PREF_PARSE_JS) {
      try {
        gPrefParseJS = Services.prefs.getBoolPref(PREF_PARSE_JS);
      } catch (e) {
      }
    } else if (data === PREF_HIDE_CONTENT) {
      try {
        gPrefHideContent = Services.prefs.getBoolPref(PREF_HIDE_CONTENT);
      } catch (e) {
      }
    }
  },
};

/**
 * bootstrap.js API
 */
function startup(aData, aReason) {
  let prefs = Services.prefs.getDefaultBranch("");
  prefs.setIntPref(PREF_PRIORITY, gPrefPriority);
  prefs.setBoolPref(PREF_PARSE_JS, gPrefParseJS);
  prefs.setBoolPref(PREF_HIDE_CONTENT, gPrefHideContent);

  [
    PREF_PRIORITY,
    PREF_PARSE_JS,
    PREF_HIDE_CONTENT,

  ].forEach((pref) => {
    OBSERVER.observe(null, "nsPref:changed", pref);
  });

  startLogview();
  Services.prefs.addObserver(PREF_ROOT, OBSERVER, false);
}

function shutdown(aData, aReason) {
  Services.prefs.removeObserver(PREF_ROOT, OBSERVER);
  endLogview();
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}
