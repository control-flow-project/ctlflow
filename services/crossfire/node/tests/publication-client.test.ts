import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { readPublications } from '@ctlflow/crossfire-domain/publication/read';
import type { Profile } from '@ctlflow/crossfire-contracts/client';
import { publishReport } from '@ctlflow/crossfire-agent-tools/publish';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';
import { contentFixture } from './support/publication.js';

test('the report command streams a local static directory through the canonical authenticated API', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.listeningAgent(fixture.admin.actor, 'reporter');
  const api = await httpFixture(scope, fixture.application); await contentFixture(scope, fixture.application);
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-publication-client-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'assets')); writeFileSync(join(directory, 'index.html'), '<p>Published by the command</p>');
  writeFileSync(join(directory, 'assets', 'main.mjs'), 'export const value = 42;');
  const profile: Profile = { workspace: directory, id: agent.id,
    settings: { instance: 'tests', server_name: fixture.application.config.serverName, homeserver: api.origin, owner: '@admin:test.localhost', max_upload_bytes: 16 * 1024 * 1024 },
    account: { user_id: agent.matrixUserId, access_token: agent.token, device_id: 'fixture-device' } };
  const published = value(await publishReport(profile, directory, 'Credit report'));
  assert.equal(published.public, true); assert.equal(published.fileCount, 2);
  assert.equal(await (await fetch(published.url)).text(), '<p>Published by the command</p>');
  assert.equal(value(readPublications(fixture.services, fixture.admin.actor, { page: 1, pageSize: 10, search: 'Credit' })).totalItems, 1);
  assert.equal((await publishReport(profile, join(directory, 'missing'), 'Report')).ok, false);
  symlinkSync(join(directory, 'index.html'), join(directory, 'link.html'));
  assert.equal((await publishReport(profile, directory, 'Report')).ok, false); rmSync(join(directory, 'link.html'));
  const invalid = await publishReport({ ...profile, settings: { ...profile.settings, homeserver: 'http://untrusted.example' } }, directory, 'Report');
  assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.error.code, 'invalid');
  assert.equal(value(readPublications(fixture.services, fixture.admin.actor, { page: 1, pageSize: 10, search: '' })).totalItems, 1);
});
