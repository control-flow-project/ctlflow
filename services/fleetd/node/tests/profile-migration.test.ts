import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { paths } from '@ctlflow/crossfire-adapter-filesystem/project';
import { privateDir, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { migrateInstanceProfiles } from '@ctlflow/fleetd-storage/profile-migration';
import type { Binding } from '@ctlflow/fleetd-storage/binding';
import type { Configuration } from '@ctlflow/fleetd-domain/model';

function fixture(scope: Parameters<typeof cleanup>[0]) {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-profile-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const instance = { key: 'agent-one', name: 'friendly-max', definition: 'analyst-max', workarea: 'agents/original/workarea/one' };
  const workarea = privateDir(join(directory, instance.workarea));
  const agentId = randomUUID(), account = { user_id: '@agent-' + agentId + ':test', access_token: 'private-native-token', device_id: 'CROSSFIRE_AGENT' };
  const configuration: Configuration = { directory, digest: 'fixture', definitions: {},
    roster: { fleet: 'team', coordination: { adapter: 'crossfire', server: 'http://127.0.0.1', owner: '@owner:test' }, instances: [instance] } };
  const binding: Binding = { server: 'http://127.0.0.1', owner: '@owner:test', fleetKey: 'team', fleetId: randomUUID(), controllerCredential: null, request: null,
    identities: [{ instanceKey: instance.key, name: 'friendly', agentId, account }] };
  const previous = paths(workarea, 'friendly'), current = paths(workarea, instance.key);
  writeJson(previous.profile, { id: agentId, workspace: workarea, account,
    settings: { instance: 'fixture', homeserver: binding.server, owner: binding.owner, server_name: 'test', max_upload_bytes: 1048576 } });
  writeJson(previous.cursors, { room: '$last-event' });
  return { configuration, binding, previous, current, agentId };
}

test('profile cutover uses immutable instance keys and preserves complete cursor/credential bytes', scope => {
  const fixtureValue = fixture(scope), { configuration, binding, previous, current } = fixtureValue;
  const profile = readFileSync(previous.profile), cursors = readFileSync(previous.cursors);
  migrateInstanceProfiles(configuration, binding);
  assert.equal(existsSync(previous.profile), false);
  assert.equal(existsSync(previous.state), false);
  assert.deepEqual(readFileSync(current.profile), profile);
  assert.deepEqual(readFileSync(current.cursors), cursors);
  migrateInstanceProfiles(configuration, binding);
  binding.identities[0]!.name = 'friendly-max';
  migrateInstanceProfiles(configuration, binding);
  assert.deepEqual(readFileSync(current.cursors), cursors);
});

test('interrupted cutover finishes its exact journal, never a second history or alias', scope => {
  const { configuration, binding, previous, current, agentId } = fixture(scope);
  writeJson(join(current.root, 'profile-migration-agent-one.json'), { agentId, source: 'friendly', target: 'agent-one', hadState: true });
  renameSync(previous.state, current.state);
  migrateInstanceProfiles(configuration, binding);
  assert.equal(existsSync(previous.profile), false);
  assert.equal(existsSync(join(current.root, 'profile-migration-agent-one.json')), false);
  assert.equal(existsSync(current.cursors), true);
});

test('active listeners, unrelated identities and target collisions are rejected without replacing private state', scope => {
  const { configuration, binding, previous, current } = fixture(scope);
  const unlock = acquireFileLock(join(previous.state, 'listener'));
  assert.throws(() => migrateInstanceProfiles(configuration, binding), /already owns/u);
  unlock();
  binding.identities[0]!.agentId = randomUUID();
  assert.throws(() => migrateInstanceProfiles(configuration, binding), /identity/u);
  assert.equal(existsSync(previous.profile), true);
  assert.equal(existsSync(current.profile), false);
  binding.identities[0]!.agentId = JSON.parse(readFileSync(previous.profile, 'utf8')).id as string;
  privateDir(current.state);
  assert.throws(() => migrateInstanceProfiles(configuration, binding), /merge/u);
  assert.equal(existsSync(previous.cursors), true);
});
