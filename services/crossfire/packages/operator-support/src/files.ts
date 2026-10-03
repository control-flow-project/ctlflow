import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { failure, success, type Result } from '@crossfire/kernel/result';
import * as check from '@crossfire/contracts/schema/validation';

export const fingerprintPlan = check.object({ files: check.list(check.object({ path: check.text(4096), private: check.boolean,
  sha256: check.optional(check.refine(check.text(64, 64), value => /^[a-f0-9]{64}$/u.test(value), 'Expected SHA-256')) }), 1000, 1) });
export function fingerprint(file: string, privateFile = true): Result<{ bytes: number; sha256: string }> {
  let descriptor: number | undefined;
  try {
    if (!file.startsWith('/') || resolve(file) !== realpathSync(file)) return failure('invalid', 'Use an absolute non-symlink file');
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.uid !== process.getuid!() || (privateFile && (before.mode & 0o077) !== 0)) return failure('invalid', 'Fingerprint requires an owned regular file with the requested privacy');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let length = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      length += count;
      if (length > before.size) return failure('conflict', 'File changed during fingerprinting');
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    const current = lstatSync(file);
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || current.dev !== before.dev || current.ino !== before.ino || realpathSync(file) !== file) return failure('conflict', 'File changed during fingerprinting');
    return success({ bytes: length, sha256: hash.digest('hex') });
  } catch { return failure('invalid', 'Cannot safely fingerprint the selected file'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}
export function verifyFingerprints(plan: check.Parsed<typeof fingerprintPlan>) {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  for (const expected of plan.files) {
    const checked = fingerprint(expected.path, expected.private);
    if (!checked.ok) return checked;
    if (expected.sha256 && expected.sha256 !== checked.value.sha256) return failure('conflict', 'File fingerprint does not match the expected bytes: ' + expected.path);
    files.push({ path: expected.path, ...checked.value });
  }
  return success({ checkedAt: new Date().toISOString(), files });
}
