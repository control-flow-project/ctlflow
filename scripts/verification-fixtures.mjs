import { lstatSync, mkdtempSync, rmSync } from 'node:fs';

export function verificationFixtures() {
  const directory = mkdtempSync('/tmp/cf-'), original = lstatSync(directory);
  if (!original.isDirectory() || original.isSymbolicLink() || original.uid !== process.getuid() || (original.mode & 0o077) !== 0) throw new Error('Verification requires an owned private fixture directory');
  const previous = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map(key => [key, process.env[key]]));
  for (const key of Object.keys(previous)) process.env[key] = directory;
  let closed = false;
  return {
    directory,
    close() {
      if (closed) return;
      const current = lstatSync(directory);
      if (!current.isDirectory() || current.isSymbolicLink() || current.uid !== original.uid || current.ino !== original.ino || current.dev !== original.dev) throw new Error('Owned verification fixture identity changed');
      rmSync(directory, { recursive: true }); closed = true;
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    },
  };
}
