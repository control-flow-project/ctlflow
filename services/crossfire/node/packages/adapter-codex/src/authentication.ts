import { decodeUtf8 } from '@ctlflow/crossfire-kernel/bytes';
import { closeSync, constants, fsyncSync, lstatSync, openSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { privateDir, readPrivateBytes } from '@ctlflow/crossfire-adapter-filesystem/index';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { hostHome, metadataExists } from './home.js';

export function refreshAuthentication(home: string): Result<void> {
  let temporary: string | undefined;
  try {
    privateDir(home);
    const source = join(hostHome(), 'auth.json'), destination = join(home, 'auth.json');
    if (metadataExists(hostHome()) && realpathSync(hostHome()) === realpathSync(home)) return failure('invalid', 'The host login home must be separate from the managed native home');
    let bytes: Buffer | undefined;
    if (metadataExists(source)) {
      bytes = readPrivateBytes(source, 65536);
      const value: unknown = JSON.parse(decodeUtf8(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native login');
    }
    if (metadataExists(destination)) {
      const info = lstatSync(destination);
      if (!info.isFile() || info.uid !== process.getuid!() || info.mode & 0o077 || info.nlink !== 1) throw new Error('Unsafe managed login');
    }
    if (bytes) {
      temporary = join(home, '.crossfire-auth-' + randomUUID());
      const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
      renameSync(temporary, destination);
    } else if (metadataExists(destination)) unlinkSync(destination);
    const directory = openSync(home, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return success(undefined);
  } catch {
    return failure('unauthorized', 'Cannot refresh the private native Codex login from the host. Check the host CODEX_HOME and sign in with codex login, then resume. Never paste credentials into chat.');
  } finally { if (temporary && metadataExists(temporary)) unlinkSync(temporary); }
}
