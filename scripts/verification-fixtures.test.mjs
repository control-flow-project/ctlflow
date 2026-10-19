import assert from 'node:assert/strict';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verificationFixtures } from './verification-fixtures.mjs';

test('verification uses a short private var-tmp directory independent of checkout and ambient temporary roots', () => {
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = '/nonexistent/' + 'long-checkout-name-'.repeat(20);
  const fixtures = verificationFixtures();
  try {
    assert.match(fixtures.directory, /^\/var\/tmp\/cf-[A-Za-z0-9]+$/u);
    assert.equal(statSync(fixtures.directory).mode & 0o777, 0o700);
    for (const key of ['TMPDIR', 'TMP', 'TEMP']) assert.equal(process.env[key], fixtures.directory);
    const controller = join(fixtures.directory, 'fleet-public-install-123456/controller');
    assert(Buffer.byteLength(join(controller, 'fleetd.sock')) <= 100);
    mkdirSync(controller, { recursive: true }); writeFileSync(join(controller, 'owned-fixture'), 'disposable');
    fixtures.close(); fixtures.close();
    assert.equal(existsSync(fixtures.directory), false);
    assert.equal(process.env.TMPDIR, '/nonexistent/' + 'long-checkout-name-'.repeat(20));
  } finally { fixtures.close(); if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; }
});
