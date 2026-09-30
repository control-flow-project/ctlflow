import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createHttpServer } from '../apps/server/src/http/create-server.js';
import { resolvePrincipals } from '@crossfire/domain/identity/resolve-principals';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { principalResolution } from '@crossfire/contracts/schema/request';
import { principalIdentities } from '@crossfire/contracts/schema/response';
import { applicationFixture, value } from './support/application.js';
import { contractRelease } from './support/release.js';

test('sender resolution distinguishes owners, their agents, other owners and unregistered lookalikes without guessing', async scope => {
  const { services, admin, member, agent } = await applicationFixture(scope);
  const other = await member('other'), lookalike = await member('agent-lookalike');
  const self = await agent(admin.actor, 'receiver'), peer = await agent(admin.actor, 'peer'), foreign = await agent(other.actor, 'foreign');
  const owner = admin.member.principal.matrixUserId, otherOwner = other.member.principal.matrixUserId;
  const ids = [owner, peer.matrixUserId, otherOwner, foreign.matrixUserId, lookalike.member.principal.matrixUserId, '@agent-unregistered:test.localhost'];
  const resolved = value(resolvePrincipals(services, self.actor, ids));
  assert.deepEqual(resolved, [
    { matrixUserId: owner, kind: 'human', ownerMatrixId: null },
    { matrixUserId: peer.matrixUserId, kind: 'agent', ownerMatrixId: owner },
    { matrixUserId: otherOwner, kind: 'human', ownerMatrixId: null },
    { matrixUserId: foreign.matrixUserId, kind: 'agent', ownerMatrixId: otherOwner },
    { matrixUserId: lookalike.member.principal.matrixUserId, kind: 'human', ownerMatrixId: null },
    { matrixUserId: ids[5], kind: 'unknown', ownerMatrixId: null },
  ]);
  const stored = value(services.repositories.principal.find({ id: peer.id }))!;
  value(services.repositories.principal.update({ ...stored, status: 'revoked' }));
  assert.deepEqual(value(resolvePrincipals(services, self.actor, [peer.matrixUserId])), [resolved[1]], 'Historical identity metadata does not invent current wake authority');
  assert.equal(resolvePrincipals(services, peer.actor, [owner]).ok, false);
  assert.equal(resolvePrincipals(services, self.actor, [owner, owner]).ok, false);
  assert.equal(resolvePrincipals(services, self.actor, []).ok, false);
});

test('sender resolution boundary rejects caller-supplied ownership, duplicate IDs and inconsistent resolved kinds', () => {
  const matrixUserId = '@sender:test.localhost';
  for (const input of [{ matrixUserIds: [] }, { matrixUserIds: [matrixUserId, matrixUserId] },
    { matrixUserIds: ['not-an-id'] }, { matrixUserIds: [matrixUserId], ownerMatrixId: matrixUserId },
    { matrixUserIds: Array.from({ length: 101 }, (_, index) => '@sender-' + index + ':test.localhost') }]) {
    assert.equal(principalResolution(input).ok, false);
  }
  for (const identity of [{ matrixUserId, kind: 'human', ownerMatrixId: matrixUserId },
    { matrixUserId, kind: 'unknown', ownerMatrixId: matrixUserId }, { matrixUserId, kind: 'agent', ownerMatrixId: null }]) {
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
  scope.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const coordination = createCoordination({ origin, token: self.token });
  const ids = [fixture.admin.member.principal.matrixUserId, self.matrixUserId, '@unknown:remote.test'];
  const result = value(await coordination.identities(ids));
  assert.deepEqual(result, value(resolvePrincipals(fixture.services, self.actor, ids)));
  const body = JSON.stringify(result);
  assert(!body.includes(self.token) && !body.includes('principalId') && !body.includes('displayName'));
  const unauthenticated = await fetch(origin + '/api/principal-resolutions', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matrixUserIds: ids }) });
  assert.equal(unauthenticated.status, 403);
  const invalid = await fetch(origin + '/api/principal-resolutions', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer ' + self.token }, body: JSON.stringify({ matrixUserIds: ids, kind: 'human' }) });
  assert.equal(invalid.status, 400);
});
