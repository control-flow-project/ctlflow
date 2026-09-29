import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { applicationFixture, value } from './support/application.js';
import { changeWakePolicy } from '@crossfire/domain/wake/change-policy';
import { deliveryPolicy } from '@crossfire/domain/agent/delivery-policy';
import { randomUUID } from 'node:crypto';

test('one schema refuses unrelated storage without modifying it', () => {
  mkdirSync('.temp', { recursive: true }); const path = join(mkdtempSync(join(process.cwd(), '.temp/schema-')), 'foreign.sqlite');
  const original = new Database(path); original.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY); INSERT INTO unrelated VALUES (\'retained\')'); original.close(); chmodSync(path, 0o600);
  assert.throws(() => openStore(path), /current Crossfire schema/);
  const inspection = new Database(path);
  assert.deepEqual(inspection.prepare('SELECT id FROM unrelated').all(), [{ id: 'retained' }]);
  assert.equal(inspection.pragma('user_version', { simple: true }), 0); inspection.close();
});
test('wake mode and selected senders persist in their canonical normalized relations', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'wake');
  for (const mode of ['owner-agents', 'humans', 'everyone', 'nobody', 'selected', 'owner'] as const) {
    const revision = value(fixture.services.directory.agent(agent.id))!.principal.revision;
    value(changeWakePolicy(fixture.services, fixture.admin.actor, agent.id, { expectedRevision: revision, mode, senderIds: mode === 'selected' ? [fixture.admin.actor.principalId] : [] }, randomUUID()));
    assert.equal(value(deliveryPolicy(fixture.services, agent.actor, agent.id)).wake.mode, mode);
    assert.equal(value(fixture.services.collection.wakeSenders({ agentId: agent.id })).length, mode === 'selected' ? 1 : 0);
  }
});
