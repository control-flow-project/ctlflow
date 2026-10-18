import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { applicationFixture, value } from './support/application.js';
import { changeWakePolicy } from '@ctlflow/crossfire-domain/wake/change-policy';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { randomUUID } from 'node:crypto';
import { migrationChange, migrationQuery, migrationRows } from './support/migration-data.js';

test('one schema refuses unrelated storage without modifying it', () => {
  mkdirSync('.temp', { recursive: true }); const path = join(mkdtempSync(join(process.cwd(), '.temp/schema-')), 'foreign.sqlite');
  const original = new Database(path);
  migrationChange(original, migrationQuery.schema.createTable('unrelated', table => table.text('id').primary()));
  migrationChange(original, migrationQuery('unrelated').insert({ id: 'retained' })); original.close(); chmodSync(path, 0o600);
  assert.throws(() => openStore(path), /Unsupported Crossfire schema.*No data was changed/u);
  const inspection = new Database(path);
  assert.deepEqual(migrationRows(inspection, migrationQuery('unrelated').select('id')), [{ id: 'retained' }]);
  assert.equal(sqliteMetadata.databaseIdentity(inspection).version, 0); inspection.close();
});
test('wake mode and selected senders persist in their canonical normalized relations', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'wake');
  for (const mode of ['humans', 'everyone', 'selected'] as const) {
    const revision = value(fixture.services.directory.agent(agent.id))!.principal.revision;
    value(changeWakePolicy(fixture.services, fixture.admin.actor, agent.id, { expectedRevision: revision, mode, senders: mode === 'selected' ? [fixture.admin.actor.principalId].map(principalId => ({ principalId, includeAgents: false })) : [] }, randomUUID()));
    assert.equal(value(deliveryPolicy(fixture.services, agent.actor, agent.id)).wake.mode, mode);
    assert.equal(value(fixture.services.collection.wakeSenders({ agentId: agent.id })).length, mode === 'selected' ? 1 : 0);
  }
});
