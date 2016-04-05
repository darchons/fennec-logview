"strict";

const libc = ctypes.open("libc.so");
const fd_t = ctypes.int;
const pid_t = ctypes.int;

const libc_open = libc.declare("open", ctypes.default_abi, fd_t,
  ctypes.char.ptr, ctypes.int, ctypes.uint16_t);
const libc_read = libc.declare("read", ctypes.default_abi, ctypes.ssize_t,
  fd_t, ctypes.voidptr_t, ctypes.size_t);
const libc_close = libc.declare("close", ctypes.default_abi, ctypes.int, fd_t);
const libc_getpid = libc.declare("getpid", ctypes.default_abi, pid_t);

const liblog = ctypes.open("liblog.so")
const logger_list_t = ctypes.voidptr_t;

const ANDROID_LOG_RDONLY   = 0x00000000;
const ANDROID_LOG_WRONLY   = 0x00000001;
const ANDROID_LOG_RDWR     = 0x00000002;
const ANDROID_LOG_ACCMODE  = 0x00000003;
const ANDROID_LOG_NONBLOCK = 0x00000800;
const ANDROID_LOG_PSTORE   = 0x80000000;

function try_declare(lib) {
  try {
    return lib.declare.apply(lib, Array.prototype.slice.call(arguments, 1));
  } catch (e) {
    return undefined;
  }
}

const liblog_open = try_declare(liblog, "android_logger_list_open", ctypes.default_abi,
  logger_list_t, ctypes.uint8_t, ctypes.int, ctypes.unsigned_int, pid_t);
const liblog_close = try_declare(liblog, "android_logger_list_free", ctypes.default_abi,
  ctypes.void_t, logger_list_t);
const liblog_read = try_declare(liblog, "android_logger_list_read", ctypes.default_abi,
  ctypes.int, logger_list_t, ctypes.voidptr_t);
const liblog_id = try_declare(liblog, "android_name_to_log_id", ctypes.default_abi,
  ctypes.uint8_t, ctypes.char.ptr);

const logger_entry = ctypes.StructType("logger_entry", [
  {"len": ctypes.uint16_t},
  {"hdr_size": ctypes.uint16_t},
  {"pid": ctypes.int32_t},
  {"tid": ctypes.int32_t},
  {"sec": ctypes.int32_t},
  {"nsec": ctypes.int32_t},
  // Start of payload
]);

const BUFFER_SIZE = 0x1400;
const BUFFER = ctypes.uint8_t.array()(BUFFER_SIZE);

var gFd = null;
var gLogger = null;

const HANDLERS = {
  "start": (message) => {

    if (liblog_open) {
      gLogger = liblog_open(liblog_id(message.file), ANDROID_LOG_RDONLY,
                            /* tails */ 0, libc_getpid());
      if (gLogger.isNull()) {
        gLogger = null;
      }
    }

    if (gLogger === null) {
      gFd = libc_open(message.file,
                      /* O_RDONLY | O_CLOEXEC */ 0x80000,
                      /* S_IRUSR */ 0x100);
      if (gFd === -1) {
        // Error opening file (pre-ICS?).
        gFd = null;
      }
    }

    if (gLogger === null && gFd === null) {
      return;
    }
    HANDLERS.read();
  },

  "read": () => {
    if (gLogger === null && gFd === null) {
      return;
    }

    // Schedule next read.
    setTimeout(HANDLERS.read, 0);

    BUFFER[0] = 0;
    let bytesRead;
    if (gLogger !== null) {
      bytesRead = liblog_read(gLogger, BUFFER);
    } else {
      bytesRead = libc_read(gFd, BUFFER, BUFFER_SIZE);
    }

    if (bytesRead < logger_entry.size || BUFFER[0] === 0) {
      return;
    }

    let entry = ctypes.cast(BUFFER, logger_entry);
    let log = {
      localTime: Date.now(),
      pid: entry.pid,
      tid: entry.tid,
      time: entry.sec * 1e3 + entry.nsec / 1e6,
    };

    BUFFER[BUFFER.length - 1] = 0;
    let hdr_size = gFd !== null ? logger_entry.size : entry.hdr_size;
    log.priority = BUFFER[hdr_size];

    let tag = ctypes.cast(BUFFER.addressOfElement(hdr_size + 1),
                          ctypes.char.ptr).readString();

    let msgStart = logger_entry.size + 1 + tag.length;
    for (; msgStart < BUFFER.length && BUFFER[msgStart] !== 0; msgStart++) {
    }

    msgStart = Math.min(msgStart + 1, BUFFER.length - 1);
    let msg = ctypes.cast(BUFFER.addressOfElement(msgStart),
                          ctypes.char.ptr).readString();

    log.tag = tag;
    log.message = msg;

    self.postMessage({
      type: "log",
      log: log,
    });
  },

  "end": () => {
    if (gLogger !== null) {
      liblog_close(gLogger);
      gLogger = null;
    }
    if (gFd !== null) {
      libc_close(gFd);
      gFd = null;
    }
    libc.close();
    liblog.close();
    self.close();
  }
};

self.addEventListener("message", (event) => {
  let message = event.data;

  if (message.type in HANDLERS) {
    return HANDLERS[message.type](message);
  }
  throw new Error("invalid message type: " + message.type);
});
