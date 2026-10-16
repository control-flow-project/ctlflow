import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTimeZones, timeZoneSource } from '../scripts/time-zones.js';

test('native and image calendars use one exact pinned IANA source, not the mutable host database', async () => {
  const source = timeZoneSource(); assert.equal(source.version, process.versions.tz); assert.match(source.sha256, /^[a-f0-9]{64}$/u);
  const root = mkdtempSync(join(tmpdir(), 'crossfire-timezone-unit-')), output = join(root, 'zoneinfo');
  try {
    await assert.rejects(prepareTimeZones('relative'), /new absolute/u);
    await assert.rejects(prepareTimeZones(root), /new absolute/u);
    const wrong: typeof fetch = async () => new Response('corrupt source');
    await assert.rejects(prepareTimeZones(output, wrong), /SHA-256/u);
    const refused: typeof fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(prepareTimeZones(output, refused), /Cannot obtain/u);
    const oversized: typeof fetch = async () => new Response(new Uint8Array(8388609));
    await assert.rejects(prepareTimeZones(output, oversized), /exceeds 8 MiB/u);
    assert.equal(existsSync(output), false); assert.deepEqual(readdirSync(root), [], 'Failed preparation removes only its own staging');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
