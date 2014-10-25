const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Prompt.jsm");

const PREF_ROOT = "extensions.logview.";
const PREF_PRIORITY = PREF_ROOT + "priority";
const PREF_PARSE_JS = PREF_ROOT + "parse_js";
const PREF_HIDE_CONTENT = PREF_ROOT + "hide_content";

const CONSOLE_TAG = "GeckoConsole";

var gWindow = null;
var gPrefPriority;
var gPrefParseJS;
var gPrefHideContent;
var gLastTimestamp = Date.now();

const RE_JSCONSOLE = /^\[?(.+?):(.+?)\]?$/;
const RE_JSCONTENT = /https?:\/\/|RFC 5746|"downloadable font:/;

function getWindow() {
  if (!gWindow) {
    gWindow = Services.wm.getMostRecentWindow("navigator:browser");
  }
  return gWindow;
}

function logCallback(log) {
  if (gPrefHideContent && log.tag === CONSOLE_TAG) {
    if (RE_JSCONTENT.test(log.message)) {
      return true;
    }
  }

  if (gPrefParseJS && log.tag === CONSOLE_TAG) {
    let parts = RE_JSCONSOLE.exec(log.message.trim());
    if (parts && parts.length >= 3) {
      log.tag = parts[1].trim();
      log.message = parts[2].trim();
      if (log.tag.indexOf("Warning") >= 0) {
        log.priority = Logs.LOG_WARN;
      } else if (log.tag.indexOf("Error") >= 0) {
        log.priority = Logs.LOG_ERROR;
      } else {
        log.priority = Logs.LOG_INFO;
      }
    }
  }

  if (log.priority < gPrefPriority) {
    return true;
  }

  let time = Date.now();
  if (time - gLastTimestamp < 100) {
    return true;
  }
  gLastTimestamp = time;

  let title = Logs.getPriorityLabel(log.priority) + "/" + log.tag;
  let linebreak = log.message.indexOf("\n");
  let options = {
    button: {
      label: "View",
      callback: () => {
        new Prompt({
          title: title,
          message: log.message,
        }).show();
      },
    },
  };

  getWindow() && gWindow.NativeWindow.toast.show(title + ": " +
    (linebreak < 0 ? log.message : log.message.substr(0, linebreak)), "short", options);
  return true;
}

const OBSERVER = {
  observe: function(subject, topic, data) {
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
  Cu.import("chrome://logview/content/Logs.jsm");

  let prefs = Services.prefs.getDefaultBranch("");
  prefs.setIntPref(PREF_PRIORITY, gPrefPriority = Logs.LOG_ERROR);
  prefs.setBoolPref(PREF_PARSE_JS, gPrefParseJS = true);
  prefs.setBoolPref(PREF_HIDE_CONTENT, gPrefHideContent = true);

  [
    PREF_PRIORITY,
    PREF_PARSE_JS,
    PREF_HIDE_CONTENT,

  ].forEach((pref) => {
    OBSERVER.observe(null, "nsPref:changed", pref);
  });

  Logs.init();
  Logs.listen(logCallback);
  Services.prefs.addObserver(PREF_ROOT, OBSERVER, false);
}

function shutdown(aData, aReason) {
  Services.prefs.removeObserver(PREF_ROOT, OBSERVER);
  Logs.unlisten(logCallback);
  Logs.term();
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}
