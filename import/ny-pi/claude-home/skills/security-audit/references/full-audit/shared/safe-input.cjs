const fs = require("node:fs");
const { TextDecoder } = require("node:util");
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
class JsonStructureError extends Error {}
class SafeInputError extends Error {}
function readFileWithinLimit(file, inputBytes) {
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlock = fs.constants.O_NONBLOCK;
  if (!Number.isInteger(noFollow) || noFollow === 0 || !Number.isInteger(nonBlock) || nonBlock === 0) {
    throw new SafeInputError("OS no-follow and nonblocking input protection is unavailable");
  }

  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonBlock);
  } catch (error) {
    if (error && (error.code === "ELOOP" || error.code === "EMLINK")) {
      throw new SafeInputError("input must not be a symlink");
    }
    throw error;
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new SafeInputError("input must be a regular file");
    }
    if (stat.size > inputBytes) {
      throw new SafeInputError(`input exceeds ${inputBytes} byte limit`);
    }

    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      bytesRead += count;
      if (bytesRead > inputBytes) {
        throw new SafeInputError(`input exceeds ${inputBytes} byte limit`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    try {
      return UTF8_DECODER.decode(Buffer.concat(chunks, bytesRead));
    } catch {
      throw new SafeInputError("input is not valid UTF-8");
    }
  } finally {
    fs.closeSync(descriptor);
  }
}


module.exports = { JsonStructureError, SafeInputError, readFileWithinLimit };
