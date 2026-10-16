import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function timeZoneSource(): { version: string; url: string; sha256: string } {
  const source = JSON.parse(readFileSync(new URL('../../assets/time-zones.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  if (Object.keys(source).sort().join(',') !== 'sha256,url,version' || typeof source.version !== 'string' || !/^20[0-9]{2}[a-z]$/u.test(source.version)
    || source.url !== 'https://data.iana.org/time-zones/releases/tzdata' + source.version + '.tar.gz' || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256)) throw new Error('Invalid pinned IANA time-zone source');
  if (source.version !== process.versions.tz) throw new Error('Native calendar parity requires the pinned Node IANA version ' + process.versions.tz);
  return source as { version: string; url: string; sha256: string };
}

export async function prepareTimeZones(output: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!isAbsolute(output) || existsSync(output)) throw new Error('Use a new absolute time-zone output directory');
  const source = timeZoneSource(), stage = mkdtempSync(join(dirname(output), '.crossfire-zoneinfo-'));
  try {
    const response = await fetcher(source.url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('Cannot obtain the pinned IANA archive');
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const bytes of response.body) { size += bytes.byteLength; if (size > 8388608) throw new Error('Pinned IANA archive exceeds 8 MiB'); chunks.push(bytes); }
    const archive = Buffer.concat(chunks);
    if (createHash('sha256').update(archive).digest('hex') !== source.sha256) throw new Error('Pinned IANA archive SHA-256 does not match');
    const path = join(stage, 'archive.tar.gz'), extracted = join(stage, 'source'), compiled = join(stage, 'zoneinfo');
    writeFileSync(path, archive, { mode: 0o600 }); mkdirSync(extracted, { mode: 0o700 }); mkdirSync(compiled, { mode: 0o700 });
    execFileSync('tar', ['-xzf', path, '-C', extracted], { timeout: 30000, maxBuffer: 65536 });
    if (readFileSync(join(extracted, 'version'), 'utf8').trim() !== source.version) throw new Error('Pinned IANA archive version does not match');
    execFileSync('zic', ['-d', compiled, ...['africa', 'antarctica', 'asia', 'australasia', 'europe', 'northamerica', 'southamerica', 'etcetera', 'factory', 'backward'].map(file => join(extracted, file))], { timeout: 30000, maxBuffer: 65536 });
    if (!statSync(join(compiled, 'Asia/Calcutta')).isFile()) throw new Error('Complete native IANA links are required');
    writeFileSync(join(compiled, 'LICENSE'), readFileSync(join(extracted, 'LICENSE')), { mode: 0o644 });
    renameSync(compiled, output);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Supply one new absolute zoneinfo directory');
  await prepareTimeZones(process.argv[2]!);
}
