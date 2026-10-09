import assert from 'node:assert/strict';
import test from 'node:test';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';
import { authenticateNativePrincipal } from '@ctlflow/crossfire-domain/session/authenticate';
import { changeMember } from '@ctlflow/crossfire-domain/member/change-member';
import { randomUUID } from 'node:crypto';

test('the public Matrix boundary forbids independent agent names and preserves human self profiles', { timeout: 60000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture());
  const agent = await fixture.agent(fixture.admin.actor, 'unique-agent');
  const profile = (userId: string, version = 'v3') => '/_matrix/client/' + version + '/profile/' + segment(userId) + '/displayname';
  const change = (token: string, path: string, body: unknown = { displayname: 'Reviewed name' }) => fetch(fixture.origin + path,
    { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const path of [profile(agent.matrixUserId, 'r0'), profile(agent.matrixUserId) + '/', profile(agent.matrixUserId).replace('displayname', '%64isplayname'),
    profile(agent.matrixUserId).replace('/v3/', '/v1/')]) assert.equal((await change(agent.token, path)).status, 404);
  assert.equal((await change(agent.token, profile(agent.matrixUserId))).status, 403);
  assert.equal((await change(fixture.admin.token, profile(agent.matrixUserId))).status, 403);
  assert.equal((await change('invalid', profile(agent.matrixUserId))).status, 401);
  const member = await fixture.member('profile-member');
  const before = value(fixture.services.directory.member(member.actor.principalId))!;
  const actor = value(await authenticateNativePrincipal(fixture.services, member.token));
  for (const protectedInput of [{ roleCode: 'administrator' as const }, { status: 'suspended' as const }]) {
    assert.equal(changeMember(fixture.services, actor, member.actor.principalId,
      { expectedRevision: before.principal.revision, displayName: 'Reviewed name', ...protectedInput }, randomUUID()).ok, false);
  }
  assert.equal((await change(member.token, profile(before.principal.matrixUserId), { displayname: 'Reviewed name', roleCode: 'administrator' })).status, 400);
  const browserRequest = { method: 'PUT', headers: { Authorization: 'Bearer ' + member.token, 'Content-Type': 'application/json',
    Cookie: '__Host-crossfire=ambient-browser-session', Origin: fixture.origin }, body: JSON.stringify({ displayname: 'Reviewed name' }) };
  assert.equal((await fetch(fixture.origin + profile(before.principal.matrixUserId), browserRequest)).status, 200);
  assert.equal((await fetch(fixture.origin + profile(before.principal.matrixUserId), { ...browserRequest,
    headers: { 'Content-Type': 'application/json', Cookie: '__Host-crossfire=ambient-browser-session', Origin: fixture.origin } })).status, 401);
  assert.equal((await fetch(fixture.origin + profile(before.principal.matrixUserId), { ...browserRequest,
    headers: { ...browserRequest.headers, Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(fixture.origin + profile(agent.matrixUserId), { ...browserRequest,
    headers: { ...browserRequest.headers, Authorization: 'Bearer ' + agent.token } })).status, 403);
  assert.equal(value(fixture.services.directory.member(member.actor.principalId))!.member.displayName, 'Reviewed name');
  assert.deepEqual(value(fixture.services.directory.member(member.actor.principalId))!.role, before.role);
  const actual = value(await nativeOk({ base: fixture.origin, token: member.token }, 'GET', API + '/profile/' + segment(member.member.principal.matrixUserId) + '/displayname'));
  assert.equal(actual.displayname, 'Reviewed name');
  assert.equal(value(fixture.services.directory.agent(agent.id))!.name, 'unique-agent');
});
