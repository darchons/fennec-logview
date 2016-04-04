const { classes: Cc, interfaces: Ci, manager: Cm, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Prompt.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function try_import(uri, name) {
  try {
    return Cu.import(uri, {})[name];
  } catch (e) {
    return undefined;
  }
}

const Snackbars = try_import("resource://gre/modules/Snackbars.jsm", "Snackbars");

const PREF_ROOT = "extensions.logview.";
const PREF_PRIORITY = PREF_ROOT + "priority";
const PREF_PARSE_JS = PREF_ROOT + "parse_js";
const PREF_HIDE_CONTENT = PREF_ROOT + "hide_content";

const CONSOLE_TAG = "GeckoConsole";

var gWindow = null;
var gMenu = null;
var gPrefPriority = 7 /* Logs.LOG_FATAL */;
var gPrefParseJS = true;
var gPrefHideContent = true;
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
    let browserApp = window.BrowserApp;
    if (!browserApp) {
      return;
    }
    let isLogsTab = (tab) => {
      if (tab.window.location.href !== "about:logs") {
        return false;
      }
      browserApp.selectTab(tab);
      return true;
    };
    if (!browserApp.tabs.some(isLogsTab)) {
      browserApp.addTab("about:logs");
    }
  });
}

function logCallback(log) {
  let {priority, tag, message} = log;

  if (gPrefHideContent && tag === CONSOLE_TAG) {
    if (RE_JSCONTENT.test(message)) {
      return;
    }
  }

  if (gPrefParseJS && tag === CONSOLE_TAG) {
    let parts = RE_JSCONSOLE.exec(message.trim());
    if (parts && parts.length >= 3) {
      tag = parts[1].trim();
      message = parts[2].trim();
      if (tag.indexOf("Warning") >= 0) {
        priority = Logs.LOG_WARN;
      } else if (tag.indexOf("Error") >= 0) {
        priority = Logs.LOG_ERROR;
      } else {
        priority = Logs.LOG_INFO;
      }
    }
  }

  if (priority < gPrefPriority) {
    return;
  }

  let time = Date.now();
  if (time - gLastTimestamp < 100) {
    return;
  }
  gLastTimestamp = time;

  let title = Logs.getPriorityLabel(priority) + "/" + tag;
  let linebreak = message.indexOf("\n");
  let text = title + ": " + (linebreak < 0 ? message : message.substr(0, linebreak));
  let callback = () => {
    new Prompt({
      title: title,
      message: message,
      buttons: ["Show logs", "Close"],
    }).show((data) => {
      if (data.button === 0) {
        showLogs();
      }
    });
  };

  if (Snackbars) {
    Snackbars.show(text, Snackbars.LENGTH_SHORT, {
      action: {
        label: "View",
        callback: callback,
      },
    });
    return;
  }

  getWindow(function(window) {
    let options = {
      button: {
        label: "View",
        callback: callback,
      },
    };
    window.NativeWindow && window.NativeWindow.toast.show(text, "short", options);
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

  [
    PREF_PRIORITY,
    PREF_PARSE_JS,
    PREF_HIDE_CONTENT,

  ].forEach((pref) => {
    OBSERVER.observe(null, "nsPref:changed", pref);
  });

  Logs.init();
  Logs.dump(logCallback);
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
  let prefs = Services.prefs.getDefaultBranch("");
  prefs.setIntPref(PREF_PRIORITY, gPrefPriority);
  prefs.setBoolPref(PREF_PARSE_JS, gPrefParseJS);
  prefs.setBoolPref(PREF_HIDE_CONTENT, gPrefHideContent);
}

function uninstall(aData, aReason) {
  if (aReason != ADDON_UNINSTALL) {
    return;
  }
  let prefs = Services.prefs.getDefaultBranch("");
  prefs.deleteBranch(PREF_ROOT);
}
