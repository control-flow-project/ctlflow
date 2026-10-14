import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function prepareTimeZones(directory) {
  const source = '/usr/share/zoneinfo/tzdata.zi';
  const version = /^# version ([^\s]+)/u.exec(readFileSync(source, 'utf8'))?.[1];
  if (!version || version !== process.versions.tz) throw new Error('Native calendar parity requires tzdata ' + process.versions.tz + '; found ' + version);
  const output = join(directory, 'zoneinfo'); mkdirSync(output, { mode: 0o700 });
  const compiled = spawnSync('zic', ['-d', output, source], { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
  if (compiled.status !== 0 || compiled.error) throw new Error('Compile the complete native IANA database before verification: ' + (compiled.error?.message ?? compiled.stderr));
  if (!statSync(join(output, 'Asia/Calcutta')).isFile()) throw new Error('The complete native IANA links are required');
  return output;
}
