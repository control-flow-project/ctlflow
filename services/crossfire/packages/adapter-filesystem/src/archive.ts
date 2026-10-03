import { readdirSync, lstatSync, renameSync, existsSync, fsyncSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { privateDir } from './index.js';

export function archiveState(source: string, target: string, selected: (name: string) => boolean): void {
  privateDir(source); privateDir(target);
  for (const name of readdirSync(source).filter(selected)) {
    const path = join(source, name), information = lstatSync(path);
    if (information.isSymbolicLink() || information.uid !== process.getuid!() || information.mode & 0o077
      || !information.isFile() && !information.isDirectory()) throw new Error('Reset can archive only private owned state');
    if (existsSync(join(target, name))) throw new Error('Reset archive conflicts with active state; no file was overwritten');
    renameSync(path, join(target, name));
  }
  for (const directory of [source, target]) { const descriptor = openSync(directory, 'r'); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
}
