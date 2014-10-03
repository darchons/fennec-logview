const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");

const window = Services.wm.getMostRecentWindow("navigator:browser");

var gWorker = null;
var gLastTimestamp = Date.now();

const LOG_VERBOSE = 2;
const LOG_DEBUG = 3;
const LOG_INFO = 4;
const LOG_WARN = 5;
const LOG_ERROR = 6;
const LOG_FATAL = 7;

const HANDLERS = {
  "log": (message) => {
    let log = message.log;

    if (log.priority < LOG_ERROR &&
        (log.tag !== "GeckoConsole" || log.message.indexOf("Error") < 0)) {
      return;
    }

    let time = Date.now();
    if (time - gLastTimestamp < 100) {
      return;
    }
    gLastTimestamp = time;

    window.NativeWindow.toast.show(log.tag + "\n" + log.message, "short");
  },
};

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

/**
 * bootstrap.js API
 */
function startup(aData, aReason) {
  startLogview();
}

function shutdown(aData, aReason) {
  endLogview();
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}
