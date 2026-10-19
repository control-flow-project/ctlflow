import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createHttpServer } from '../apps/server/src/http/create-server.js';
import { resolvePrincipals } from '@ctlflow/crossfire-domain/identity/resolve-principals';
import { createCoordination } from '@ctlflow/crossfire-adapter-crossfire/coordination';
import { principalResolution } from '@ctlflow/crossfire-contracts/schema/request';
import { principalIdentities } from '@ctlflow/crossfire-contracts/schema/response';
import { applicationFixture, value } from './support/application.js';
import { contractRelease } from './support/release.js';

test('sender resolution distinguishes owners, their agents, other owners and unregistered lookalikes without guessing', async scope => {
  const { services, admin, member, agent } = await applicationFixture(scope);
  const other = await member('other'), lookalike = await member('agent-lookalike');
  const self = await agent(admin.actor, 'receiver'), peer = await agent(admin.actor, 'peer'), foreign = await agent(other.actor, 'foreign');
  const owner = admin.member.principal.backendUserId, otherOwner = other.member.principal.backendUserId;
  const ids = [owner, peer.backendUserId, otherOwner, foreign.backendUserId, lookalike.member.principal.backendUserId, '@agent-unregistered:test.localhost'];
  const resolved = value(resolvePrincipals(services, self.actor, ids));
  assert.deepEqual(resolved, [
    { backendUserId: owner, kind: 'human', ownerBackendUserId: null, displayName: 'admin', ownerDisplayName: null },
    { backendUserId: peer.backendUserId, kind: 'agent', ownerBackendUserId: owner, displayName: 'peer (admin)', ownerDisplayName: 'admin' },
    { backendUserId: otherOwner, kind: 'human', ownerBackendUserId: null, displayName: 'other', ownerDisplayName: null },
    { backendUserId: foreign.backendUserId, kind: 'agent', ownerBackendUserId: otherOwner, displayName: 'foreign (other)', ownerDisplayName: 'other' },
    { backendUserId: lookalike.member.principal.backendUserId, kind: 'human', ownerBackendUserId: null, displayName: 'agent-lookalike', ownerDisplayName: null },
    { backendUserId: ids[5], kind: 'unknown', ownerBackendUserId: null, displayName: null, ownerDisplayName: null },
  ]);
  const stored = value(services.repositories.principal.find({ id: peer.id }))!;
  value(services.repositories.principal.update({ ...stored, status: 'revoked' }));
  assert.deepEqual(value(resolvePrincipals(services, self.actor, [peer.backendUserId])), [resolved[1]], 'Historical identity metadata does not invent current wake authority');
  assert.equal(resolvePrincipals(services, peer.actor, [owner]).ok, false);
  assert.equal(resolvePrincipals(services, self.actor, [owner, owner]).ok, false);
  assert.equal(resolvePrincipals(services, self.actor, []).ok, false);
});

test('sender resolution boundary rejects caller-supplied ownership, duplicate IDs and inconsistent resolved kinds', () => {
  const backendUserId = '@sender:test.localhost';
  for (const input of [{ backendUserIds: [] }, { backendUserIds: [backendUserId, backendUserId] },
    { backendUserIds: ['invalid\nidentity'] }, { backendUserIds: [backendUserId], ownerBackendUserId: backendUserId },
    { backendUserIds: Array.from({ length: 101 }, (_, index) => '@sender-' + index + ':test.localhost') }]) {
    assert.equal(principalResolution(input).ok, false);
  }
  for (const identity of [{ backendUserId, kind: 'human', ownerBackendUserId: backendUserId },
    { backendUserId, kind: 'unknown', ownerBackendUserId: backendUserId }, { backendUserId, kind: 'agent', ownerBackendUserId: null }]) {
    assert.equal(principalIdentities([identity]).ok, false);
  }
});

test('authenticated HTTP resolves sender metadata through the coordination adapter without exposing credentials', async scope => {
  const fixture = await applicationFixture(scope);
  const self = await fixture.agent(fixture.admin.actor, 'receiver');
  const server = createHttpServer(fixture.application, { wake() {}, drain: async () => {}, stop: async () => {} }, contractRelease());
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  fixture.application.config.publicOrigin = origin; fixture.services.instance.publicOrigin = origin;
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const coordination = createCoordination({ origin, token: self.token });
  const ids = [fixture.admin.member.principal.backendUserId, self.backendUserId, '@unknown:remote.test'];
  const result = value(await coordination.identities(ids));
  assert.deepEqual(result, value(resolvePrincipals(fixture.services, self.actor, ids)));
  const body = JSON.stringify(result);
  assert(!body.includes(self.token) && !body.includes('principalId'));
  assert(result.every(identity => 'displayName' in identity && 'ownerDisplayName' in identity));
  const unauthenticated = await fetch(origin + '/api/principal-resolutions', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backendUserIds: ids }) });
  assert.equal(unauthenticated.status, 403);
  const invalid = await fetch(origin + '/api/principal-resolutions', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer ' + self.token }, body: JSON.stringify({ backendUserIds: ids, kind: 'human' }) });
  assert.equal(invalid.status, 400);
});
