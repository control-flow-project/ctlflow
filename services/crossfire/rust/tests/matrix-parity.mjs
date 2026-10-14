import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { conduitFixture } from '../../dist/scripts/architecture-proof/conduit-fixture.js';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { verifyTestResources } from '../../../../scripts/test-resources.mjs';

const [binary] = process.argv.slice(2);
assert(binary && process.argv.length === 3 && binary.startsWith('/'), 'One compiled Rust Matrix authority executable is required');
assert(process.cwd().endsWith('/services/crossfire'), 'Native Matrix verification uses its service root');
verifyTestResources();

test('Rust Matrix authority uses actual pinned Conduit with owner privacy and native controls', { timeout: 60_000 }, async context => {
  const jwtSecret = randomBytes(32).toString('hex');
  const conduit = await conduitFixture(context, { jwtSecret });
  const owner = await conduit.register('rust-owner');
  const outsider = await conduit.register('rust-outsider');
  const directory = mkdtempSync(join(process.cwd(), '.temp/rust-matrix-')); chmodSync(directory, 0o700);
  cleanup(context, () => rmSync(directory, { recursive: true }));
  const file = join(directory, 'configuration.json');
  writeFileSync(file, JSON.stringify({ origin: conduit.base, serverName: 'architecture.localhost', jwtSecret,
    registrationSecret: conduit.registrationToken, owner: owner.id, ownerToken: owner.token, outsider: outsider.id, agent: '@rust-specialist:architecture.localhost' }), { mode: 0o600 });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65_536); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-65_536); });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 45_000);
    cleanup(context, () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      if (code !== 0) reject(new Error(`Native Rust Matrix acceptance failed (${signal ?? code})\n${errors}${output}`));
      else resolve(JSON.parse(output));
    });
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.provider, 'pinned native Conduit');
  assert(result.assertions >= 23, 'Every native owner privacy and control assertion must execute');
  context.diagnostic(JSON.stringify(result));
});
