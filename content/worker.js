"strict";

const libc = ctypes.open("libc.so");
const fd_t = ctypes.int;
const open = libc.declare("open", ctypes.default_abi, fd_t,
  ctypes.char.ptr, ctypes.int, ctypes.uint16_t);
const read = libc.declare("read", ctypes.default_abi, ctypes.ssize_t,
  fd_t, ctypes.voidptr_t, ctypes.size_t);
const close = libc.declare("close", ctypes.default_abi, ctypes.int, fd_t);

const logger_entry = ctypes.StructType("logger_entry", [
  {"len": ctypes.uint16_t},
  {"__pad": ctypes.uint16_t},
  {"pid": ctypes.int32_t},
  {"tid": ctypes.int32_t},
  {"sec": ctypes.int32_t},
  {"nsec": ctypes.int32_t},
  // Start of payload
]);

const BUFFER_SIZE = 0x1000;
const BUFFER = ctypes.uint8_t.array()(BUFFER_SIZE);

var gFd = null;

const HANDLERS = {
  "start": (message) => {
    gFd = open(message.file,
               /* O_RDONLY | O_CLOEXEC */ 0x80000,
               /* S_IRUSR */ 0x100);
    HANDLERS.read();
  },

  "read": () => {
    if (!gFd) {
      return;
    }

    // Schedule next read.
    setTimeout(HANDLERS.read, 0);

    BUFFER[0] = 0;
    let bytesRead = read(gFd, BUFFER, BUFFER_SIZE);

    if (bytesRead < logger_entry.size || BUFFER[0] === 0) {
      return;
    }

    let entry = ctypes.cast(BUFFER, logger_entry);
    let log = {
      pid: entry.pid,
      tid: entry.tid,
      time: new Date(entry.sec * 1e3 + entry.nsec / 1e6),
      priority: BUFFER[logger_entry.size],
    };

    let msgStart = logger_entry.size + 1;
    for (; msgStart < BUFFER.length; msgStart++) {
      if (BUFFER[msgStart] === 0) {
        break;
      }
    }

    msgStart = Math.min(msgStart + 1, BUFFER.length - 1);
    BUFFER[BUFFER.length - 1] = 0;

    let tag = ctypes.cast(BUFFER.addressOfElement(logger_entry.size + 1),
                          ctypes.char.ptr).readString();
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
    close(gFd);
    gFd = null;
    libc.close();
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
