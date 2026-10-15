import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';

export function prepareControllerRoot(root: string): string {
  if (!isAbsolute(root) || resolve(root) !== root) throw new Error('Controller root must be an absolute normalized directory');
  if (existsSync(root)) {
    const information = lstatSync(root);
    if (!information.isDirectory() || realpathSync(root) !== root || information.uid !== process.getuid!() || information.mode & 0o077) {
      throw new Error('An existing controller root must already be a private, owned, non-symlink directory; choose a separate new directory');
    }
    return root;
  }
  return privateDir(root);
}
