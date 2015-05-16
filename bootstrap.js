const { classes: Cc, interfaces: Ci, manager: Cm, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Prompt.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const PREF_ROOT = "extensions.logview.";
const PREF_PRIORITY = PREF_ROOT + "priority";
const PREF_PARSE_JS = PREF_ROOT + "parse_js";
const PREF_HIDE_CONTENT = PREF_ROOT + "hide_content";

const CONSOLE_TAG = "GeckoConsole";

var gWindow = null;
var gMenu = null;
var gPrefPriority;
var gPrefParseJS;
var gPrefHideContent;
var gLastTimestamp = Date.now();

// [JavaScript Warning: "foo bar"]
// [JavaScript Error: "foo bar"]
const RE_JSCONSOLE = /^\[?(.+?):([^\/].+?)\]?$/;
const RE_JSCONTENT = /https?:\/\/|RFC 5746|"downloadable font:/;

function getWindow(fn) {
  if (!gWindow) {
    gWindow = Services.wm.getMostRecentWindow("navigator:browser");
  }

  if (gWindow) {
    return fn(gWindow);
  }

  // Wait for a window.
  let listener = {
    onOpenWindow: function(window) {
      let domWindow = window.QueryInterface(Ci.nsIInterfaceRequestor)
                            .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
      let onLoad = () => {
        if (!gWindow) {
          gWindow = domWindow;
        }
        fn(gWindow);
        domWindow.removeEventListener("UIReady", onLoad);
      };
      domWindow.addEventListener("UIReady", onLoad);
      Services.wm.removeListener(listener);
    },
  };
  Services.wm.addListener(listener);
}

function showLogs() {
  getWindow(function(window) {
    var browserApp = window.BrowserApp;
    if (!browserApp) {
      return;
    }
    browserApp.tabs.forEach((tab) => {
      if (!browserApp || tab.window.location.href !== "about:logs") {
        return;
      }
      browserApp.selectTab(tab);
      browserApp = null;
    });
    browserApp && browserApp.addTab("about:logs");
  });
}

function logCallback(log) {
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
        log.priority = Logs.LOG_WARN;
      } else if (log.tag.indexOf("Error") >= 0) {
        log.priority = Logs.LOG_ERROR;
      } else {
        log.priority = Logs.LOG_INFO;
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

  let title = Logs.getPriorityLabel(log.priority) + "/" + log.tag;
  let linebreak = log.message.indexOf("\n");
  let options = {
    button: {
      label: "View",
      callback: () => {
        new Prompt({
          title: title,
          message: log.message,
          buttons: ["Show logs", "Close"],
        }).show((data) => {
          if (data.button === 0) {
            showLogs();
          }
        });
      },
    },
  };

  getWindow(function(window) {
    window.NativeWindow.toast.show(
      title + ": " + (linebreak < 0 ? log.message : log.message.substr(0, linebreak)),
      "short", options);
  });
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

// Taken from https://github.com/staktrace/aboutlogcat
function AboutModule() {
}

AboutModule.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),
  classDescription: "about:logs",
  classID: Components.ID("{f2e5dc15-d060-4c30-ae6d-61c953297e63}"),
  contractID: "@mozilla.org/network/protocol/about;1?what=logs",

  newChannel: function(uri) {
    var channel = Services.io.newChannel("chrome://logview/content/aboutLogs.html", null, null);
    channel.originalURI = uri;
    return channel;
  },

  getURIFlags: function(uri) {
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  }
};

const ABOUT_FACTORY =
  XPCOMUtils.generateNSGetFactory([AboutModule])(AboutModule.prototype.classID);

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

  Cm.QueryInterface(Ci.nsIComponentRegistrar).registerFactory(
    AboutModule.prototype.classID, AboutModule.prototype.classDescription,
    AboutModule.prototype.contractID, ABOUT_FACTORY);

  getWindow((window) => {
    gMenu = window.NativeWindow.menu.add({
      name: "Logs",
      parent: window.NativeWindow.menu.toolsMenuID,
      callback: showLogs
    });
  });
}

function shutdown(aData, aReason) {
  if (gMenu != null) {
    getWindow((window) => {
      window.NativeWindow.menu.remove(gMenu);
    });
  }

  Cm.unregisterFactory(AboutModule.prototype.classID, ABOUT_FACTORY);

  Services.prefs.removeObserver(PREF_ROOT, OBSERVER);
  Logs.unlisten(logCallback);
  Logs.term();
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}
