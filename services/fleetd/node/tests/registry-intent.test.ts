import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';

test('one canonical private desired-intent relation is unique, bounded, ordered and durable', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-intent-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const registry = createRegistry(directory), fleetId = randomUUID();
  assert.deepEqual(registry.desiredIntent(), { ok: true, value: [] });
  assert(registry.saveDesiredIntent([{ fleetId, instanceKey: 'zulu' }, { fleetId, instanceKey: 'alpha' }]).ok);
  const expected = { ok: true, value: [{ fleetId, instanceKey: 'alpha' }, { fleetId, instanceKey: 'zulu' }] };
  assert.deepEqual(registry.desiredIntent(), expected); assert.deepEqual(createRegistry(directory).desiredIntent(), expected);
  const before = readFileSync(join(directory, 'desired-intent.json'));
  assert.equal(registry.saveDesiredIntent([{ fleetId, instanceKey: 'alpha' }, { fleetId, instanceKey: 'alpha' }]).ok, false);
  assert(readFileSync(join(directory, 'desired-intent.json')).equals(before));
  const invalid = [{ oldDesired: ['alpha'] }, { fleetId, instanceKey: 'alpha', phase: 'running' }, { fleetId, instanceKey: '../escape' }];
  for (const input of invalid) {
    writeFileSync(join(directory, 'desired-intent.json'), JSON.stringify(input), { mode: 0o600 });
    assert.equal(registry.desiredIntent().ok, false);
  }
});

test('the complete 100-fleet by 100-instance limit fits the explicit storage budget', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-intent-full-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const registry = createRegistry(directory), fleets = Array.from({ length: 100 }, () => randomUUID());
  const intents = fleets.flatMap(fleetId => Array.from({ length: 100 }, (_, index) => ({ fleetId, instanceKey: 'agent-' + String(index).padStart(34, '0') })));
  assert(registry.saveDesiredIntent(intents).ok); const loaded = registry.desiredIntent(); assert(loaded.ok); assert.equal(loaded.value.length, 10000);
  assert.equal(registry.saveDesiredIntent([...intents, { fleetId: randomUUID(), instanceKey: 'overflow' }]).ok, false);
  assert.equal(registry.saveDesiredIntent(Array.from({ length: 101 }, (_, index) => ({ fleetId: fleets[0]!, instanceKey: 'agent-' + index }))).ok, false);
});

test('desired-intent readers refuse symlink, nonprivate and oversized state instead of adopting it', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-intent-unsafe-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const registry = createRegistry(directory), file = join(directory, 'desired-intent.json'), outside = join(directory, 'outside.json');
  writeFileSync(outside, '[]', { mode: 0o600 }); symlinkSync(outside, file);
  assert.equal(registry.desiredIntent().ok, false); rmSync(file);
  symlinkSync(join(directory, 'missing.json'), file);
  assert.equal(registry.desiredIntent().ok, false); rmSync(file);
  writeFileSync(file, '[]', { mode: 0o600 }); chmodSync(file, 0o644); assert.equal(registry.desiredIntent().ok, false); chmodSync(file, 0o600);
  writeFileSync(file, ' '.repeat(2 * 1024 * 1024 + 1)); assert.equal(registry.desiredIntent().ok, false);
});

test('saved resume selections are private, durable, unique and fail closed for dangling state', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-resume-selection-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const registry = createRegistry(directory), fleetId = randomUUID();
  assert.deepEqual(registry.resumeSelections(), { ok: true, value: [] });
  assert(registry.saveResumeSelections([{ fleetId, instanceKeys: ['zulu', 'alpha'] }]).ok);
  assert.deepEqual(createRegistry(directory).resumeSelections(), { ok: true, value: [{ fleetId, instanceKeys: ['alpha', 'zulu'] }] });
  assert.equal(registry.saveResumeSelections([{ fleetId, instanceKeys: ['alpha', 'alpha'] }]).ok, false);
  assert.equal(registry.saveResumeSelections([{ fleetId, instanceKeys: [] }, { fleetId, instanceKeys: [] }]).ok, false);
  const file = join(directory, 'resume-selections.json'); rmSync(file); symlinkSync(join(directory, 'missing.json'), file);
  assert.equal(registry.resumeSelections().ok, false);
});
