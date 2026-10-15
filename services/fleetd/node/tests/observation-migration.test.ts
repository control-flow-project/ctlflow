import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, symlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { privateDir, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { paths } from '@ctlflow/crossfire-adapter-filesystem/project';
import { saveBinding } from '@ctlflow/fleetd-storage/binding';
import { loadConfiguration } from '@ctlflow/fleetd-storage/configuration';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { observation } from '@ctlflow/crossfire-contracts/runtime';
import { convertObservationJournal, migrateObservationJournals } from '../tools/observation-migration.js';

const previous = { sessionId: 'retained', roomId: null, runtime: 'codex', state: 'unavailable', observedAt: 1,
  settings: [{ name: 'model', configured: 'fixture', effective: 'fixture' }], errorMessage: null, historyMode: 'shared', maxInputBytes: 65536 };
const output = [{ id: 'pending-output', text: 'private output\n😀', sources: ['source'], streamId: null, sealed: true }];
const signal = () => new AbortController().signal;

function fixture(scope: Parameters<typeof cleanup>[0]) {
  const directory = mkdtempSync(join(tmpdir(), 'observation-migration-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const root = privateDir(join(directory, 'controller')), fleet = privateDir(join(directory, 'fleet'));
  const definition = privateDir(join(fleet, 'agents', 'analyst'));
  writeFileSync(join(definition, 'agent.toml'), 'name="Analyst"\nruntime="codex"\n[runtime_options]\nmodel="fixture"\n', { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Fixture instructions.', { mode: 0o600 });
  const keys = ['analyst-one', 'analyst-two'];
  writeFileSync(join(fleet, 'runtime.toml'), 'fleet="research"\n[coordination]\nadapter="crossfire"\nserver="https://example.test"\nowner="@owner:test"\n'
    + keys.map(key => '[[instances]]\nkey="' + key + '"\nname="' + key + '-max"\ndefinition="analyst"\nworkarea="agents/analyst/workarea/' + key + '"\n').join(''), { mode: 0o600 });
  const configured = loadConfiguration(fleet); assert(configured.ok, configured.ok ? 'valid fixture' : configured.error.message);
  const registered = createRegistry(root).saveRegistrations([{ fleetId: randomUUID(), fleetKey: 'research', directory: fleet,
    label: 'Research', revision: 0, digest: configured.value.digest }]); assert(registered.ok);
  const identities = keys.map(key => {
    const agentId = randomUUID();
    return { instanceKey: key, name: key + '-max', agentId,
      account: { user_id: '@agent-' + agentId + ':test', access_token: 'private-' + key, device_id: 'fixture' } };
  });
  saveBinding(fleet, { server: 'https://example.test', owner: '@owner:test', fleetKey: 'research', fleetId: randomUUID(),
    controllerCredential: 'private-controller', request: null, identities });
  const locals = identities.map(identity => {
    const workspace = privateDir(join(definition, 'workarea', identity.instanceKey)), local = paths(workspace, identity.instanceKey);
    writeJson(local.profile, { id: identity.agentId, workspace, account: identity.account,
      settings: { instance: 'fixture', homeserver: 'https://example.test', owner: '@owner:test', server_name: 'test', max_upload_bytes: 1048576 } });
    writeJson(local.cursors, { retainedRoom: '$unchanged' });
    writeJson(local.cursors + '.observation', { output, observations: [previous] });
    return local;
  });
  return { root, fleet, locals, backup: join(directory, 'backup') };
}

test('verified previous observations gain only unknown lifecycle metadata; output and exact evidence remain intact', () => {
  const result = convertObservationJournal({ output, observations: [previous] });
  assert(result.ok);
  assert.equal(result.value.converted, 1);
  assert.deepEqual(result.value.journal.output, output);
  assert.deepEqual(result.value.journal.observations, [{ ...previous, lastActivityAt: null, historyAvailable: null }]);
  assert.equal(observation(result.value.journal.observations[0]).ok, true);
  const current = convertObservationJournal(result.value.journal);
  assert(current.ok); assert.equal(current.value.converted, 0); assert.deepEqual(current.value.journal, result.value.journal);
  for (const input of [null, [], {}, { output, observations: [null] }, { output, observations: [{ ...previous, unknown: true }] },
    { output, observations: [{ ...previous, observedAt: -1 }] }, { output, observations: [{ ...previous, lastActivityAt: null }] },
    { output, observations: [previous], unknown: true }]) assert.equal(convertObservationJournal(input).ok, false);
});

test('offline conversion backs up all exact bytes before updates and preserves profiles/cursors; reruns are no-ops', scope => {
  const { root, fleet, locals, backup } = fixture(scope);
  const original = locals.map(local => ({ profile: readFileSync(local.profile), cursor: readFileSync(local.cursors), journal: readFileSync(local.cursors + '.observation') }));
  const result = migrateObservationJournals({ root, directory: fleet, backup }, signal());
  assert(result.ok, result.ok ? 'migration succeeded' : result.error.message);
  for (const [index, local] of locals.entries()) {
    assert.deepEqual(readFileSync(join(backup, 'analyst-' + (index ? 'two' : 'one') + '.json')), original[index]!.journal);
    assert.deepEqual(readFileSync(local.profile), original[index]!.profile);
    assert.deepEqual(readFileSync(local.cursors), original[index]!.cursor);
    const parsed = convertObservationJournal(JSON.parse(readFileSync(local.cursors + '.observation', 'utf8')));
    assert(parsed.ok); assert.equal(parsed.value.converted, 0); assert.deepEqual(parsed.value.journal.output, output);
  }
  assert.equal(existsSync(join(backup, 'manifest.json')), true);
  const next = backup + '-next';
  const repeated = migrateObservationJournals({ root, directory: fleet, backup: next }, signal());
  assert(repeated.ok); assert.equal(existsSync(next), false);
});

test('active controller/listener/receiver writers fail without journal mutation and release every acquired lock', scope => {
  const { root, fleet, locals, backup } = fixture(scope);
  const bytes = readFileSync(locals[0]!.cursors + '.observation');
  for (const path of [join(root, 'daemon'), join(locals[0]!.state, 'listener'), join(locals[0]!.state, 'receiver')]) {
    const release = acquireFileLock(path);
    try {
      const result = migrateObservationJournals({ root, directory: fleet, backup }, signal());
      assert.equal(result.ok, false); assert(!result.ok); assert.match(result.error.message, /already owns/u);
    }
    finally { release(); }
    assert.deepEqual(readFileSync(locals[0]!.cursors + '.observation'), bytes);
    assert.equal(existsSync(backup), false);
    acquireFileLock(join(root, 'daemon'))(); acquireFileLock(join(locals[0]!.state, 'listener'))();
  }
});

test('a partially completed conversion resumes only its remaining previous-schema files', scope => {
  const { root, fleet, locals, backup } = fixture(scope);
  const converted = convertObservationJournal({ output, observations: [previous] }); assert(converted.ok);
  writeJson(locals[0]!.cursors + '.observation', converted.value.journal);
  const first = readFileSync(locals[0]!.cursors + '.observation');
  const migrated = migrateObservationJournals({ root, directory: fleet, backup }, signal());
  assert(migrated.ok, migrated.ok ? 'remaining migration succeeded' : migrated.error.message);
  assert.deepEqual(readFileSync(locals[0]!.cursors + '.observation'), first);
  assert.equal(existsSync(join(backup, 'analyst-one.json')), false);
  assert.equal(existsSync(join(backup, 'analyst-two.json')), true);
});

test('full preflight rejects malformed peers, identity mismatches, symlinks and unsafe backup placement before conversion', scope => {
  const { root, fleet, locals, backup } = fixture(scope);
  const first = readFileSync(locals[0]!.cursors + '.observation'), second = readFileSync(locals[1]!.cursors + '.observation');
  writeJson(locals[1]!.cursors + '.observation', { output, observations: [{ ...previous, historyAvailable: false }] });
  assert.equal(migrateObservationJournals({ root, directory: fleet, backup }, signal()).ok, false);
  assert.deepEqual(readFileSync(locals[0]!.cursors + '.observation'), first); assert.equal(existsSync(backup), false);
  writeFileSync(locals[1]!.cursors + '.observation', second);
  const profile = readFileSync(locals[1]!.profile), changed = JSON.parse(profile.toString('utf8')) as { id: string };
  changed.id = randomUUID(); writeJson(locals[1]!.profile, changed);
  assert.equal(migrateObservationJournals({ root, directory: fleet, backup }, signal()).ok, false);
  writeFileSync(locals[1]!.profile, profile);
  for (const path of [join(root, 'backup'), join(fleet, 'backup'), root, backup + '/../relative']) assert.equal(migrateObservationJournals({ root, directory: fleet, backup: path }, signal()).ok, false);
  const link = backup + '-link'; symlinkSync(root, link);
  assert.equal(migrateObservationJournals({ root: link, directory: fleet, backup }, signal()).ok, false);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal(migrateObservationJournals({ root, directory: fleet, backup }, cancelled.signal).ok, false);
  assert.deepEqual(readFileSync(locals[0]!.cursors + '.observation'), first); assert.equal(existsSync(backup), false);
});
