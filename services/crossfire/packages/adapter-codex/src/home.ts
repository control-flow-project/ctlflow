import { existsSync, writeFileSync, constants, openSync, fstatSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { privateDir } from '@crossfire/adapter-filesystem/index';

export function prepareHome(workspace: string): string {
  const home = privateDir(join(workspace, '.codex'));
  if (existsSync(join(home, 'auth.json'))) return home;
  const source = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
  if (!existsSync(source)) return home;
  const descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size > 65536 || info.mode & 0o077) throw new Error('Native login must be a private, owned file');
    const bytes = readFileSync(descriptor);
    if (bytes.length > 65536) throw new Error('Native login exceeds its size bound');
    writeFileSync(join(home, 'auth.json'), bytes, { flag: 'wx', mode: 0o600 });
  } finally { closeSync(descriptor); }
  return home;
}
