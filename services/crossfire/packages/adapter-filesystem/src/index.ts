import { mkdirSync, openSync, closeSync, writeFileSync, renameSync, unlinkSync, chmodSync, fsyncSync,
  existsSync, lstatSync, realpathSync, constants, fstatSync, readSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_JSON_BYTES } from "@crossfire/contracts/limits";

export function privateDir(path: string): string {
  if (!existsSync(path)) {
    const parent = dirname(path);
    if (parent !== path && !existsSync(parent)) privateDir(parent);
    if (realpathSync(parent) !== resolve(parent)) throw new Error("Private state cannot traverse symlink directories");
    mkdirSync(path, { mode: 0o700 });
  }
  const information = lstatSync(path);
  if (!information.isDirectory() || information.isSymbolicLink() || information.uid !== process.getuid!()
    || realpathSync(path) !== resolve(path)) {
    throw new Error("Private state must be an owned, non-symlink directory");
  }
  chmodSync(path, 0o700);
  return path;
}

export function readPrivateBytes(path: string, maximum: number): Buffer {
  if (realpathSync(dirname(path)) !== resolve(dirname(path))) throw new Error("Private state cannot traverse symlink directories");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size > maximum
      || (info.mode & 0o077) !== 0) throw new Error("State must be a private, bounded, owned regular file");
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    for (;;) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      size += count;
      if (size > info.size) throw new Error("Private state changed during its bounded read");
      if (!count) break;
    }
    if (size !== info.size || fstatSync(descriptor).size !== info.size) throw new Error('Private state changed during its bounded read');
    return bytes.subarray(0, size);
  } finally { closeSync(descriptor); }
}
export function readJson<T>(path: string, maximumBytes = MAX_JSON_BYTES): T {
  return JSON.parse(readPrivateBytes(path, maximumBytes).toString('utf8')) as T;
}

export function writeJson(path: string, value: unknown, maximumBytes = MAX_JSON_BYTES): void {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || bytes.length > maximumBytes) throw new Error("State exceeds its finite byte limit");
  privateDir(dirname(path));
  if (existsSync(path)) readJson<unknown>(path, maximumBytes);
  const temporary = join(dirname(path), ".pending-" + randomUUID());
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  try {
    renameSync(temporary, path);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
