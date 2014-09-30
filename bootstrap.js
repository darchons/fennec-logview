const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

function showToast(aWindow) {
  aWindow.NativeWindow.toast.show(Strings.GetStringFromName("toast.message"), "short");
}

var gToastMenuId = null;

/**
 * bootstrap.js API
 */
function startup(aData, aReason) {
}

function shutdown(aData, aReason) {
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}
