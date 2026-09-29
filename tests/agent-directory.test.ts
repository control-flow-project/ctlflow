import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { openStore } from '../apps/server/src/data/database.js';
import * as queries from '../apps/server/src/data/queries.js';
import { context, hash, secret, type Human } from '../apps/server/src/context.js';
import { decide, requestEnrollment } from '../apps/server/src/enrollment.js';
import { heartbeat, disconnect } from '../apps/server/src/activity.js';
import { httpService } from '../apps/server/src/http.js';
import { success, type Result } from '../packages/kernel/src/result.js';
import type { AgentView, Status } from '../packages/contracts/src/management.js';
import { releaseFixture } from './release-fixture.js';
import { deliveryPolicy } from '../packages/contracts/src/delivery.js';

function value<T>(result: Result<T>): T { assert(result.ok, JSON.stringify(result)); return result.value; }

test('HTTP agent filters retain owner isolation and apply before pagination; settings remain administrator-only', async scope => {
  const store = openStore(':memory:');
  const initial = context(store, { instance: 'directory', serverName: 'tests.localhost', publicOrigin: 'http://127.0.0.1',
    matrixOrigin: 'http://127.0.0.1', administrator: '@admin:tests.localhost', registrationSecret: secret(), jwtSecret: secret() });
  const ctx = { ...initial, native: { ...initial.native, identify: async (token: string) => success(token) } };
  function member(id: string) {
    if (!queries.member(store, id)) queries.insertMember(store, { id, label: id, role: 'member', status: 'active', revision: 0,
      created: ctx.now(), appliedStatus: null, appliedRevision: null, lastSuccess: null, error: null });
    const credential = secret();
    queries.insertSession(store, { hash: hash(credential), member: id, token: id, csrf: 'fixture-csrf', expires: ctx.now() + 60_000 });
    return { human: { id, sessionHash: hash(credential) }, headers: { Cookie: 'crossfire=' + credential } };
  }
  const admin = member(ctx.config.administrator);
  const alice = member('@alice:tests.localhost');
  const bob = member('@bob:tests.localhost');
  function agent(owner: Human, status: Status) {
    const request = value(requestEnrollment(ctx, { owner: owner.id, name: status })) as { id: string; code: string };
    const approved = value(decide(ctx, owner, request.id, { decision: 'approve', code: request.code })) as { agent: string };
    if (status !== 'active') queries.changeAgent(store, approved.agent, 0, status, null, '[]', 0, 'owner');
    return approved.agent;
  }
  const aliceActive = agent(alice.human, 'active');
  agent(alice.human, 'suspended');
  const aliceRevoked = agent(alice.human, 'revoked');
  agent(bob.human, 'active');
  agent(bob.human, 'suspended');
  agent(bob.human, 'revoked');
  const release = await releaseFixture();
  value(heartbeat(ctx, aliceActive, { release: release.manifest.release, run: randomUUID(), messages: 1, stopped: false }, release.manifest));
  const server = httpService(ctx, { wake() {}, drain: async () => {}, stop: async () => {} }, release);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;
  ctx.config.publicOrigin = origin;
  scope.after(async () => { ctx.native.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  async function list(viewer: typeof alice, search = '') {
    const response = await fetch(origin + '/_coord/agents' + search, { headers: viewer.headers });
    assert.equal(response.status, 200);
    return await response.json() as { items: AgentView[]; next: string | null };
  }
  assert.equal((await list(admin)).items.length, 4);
  assert.equal((await list(admin, '?status=active,suspended,revoked')).items.length, 6);
  for (const viewer of [alice, bob]) {
    const result = await list(viewer);
    assert.equal(result.items.length, 2);
    assert(result.items.every(item => item.owner === viewer.human.id));
    const all = await list(viewer, '?status=active,suspended,revoked');
    assert.equal(all.items.length, 3);
    assert(all.items.every(item => item.owner === viewer.human.id));
  }
  assert.deepEqual((await list(alice, '?status=revoked')).items.map(item => item.id), [aliceRevoked]);
  assert.deepEqual((await list(admin, '?listener=online')).items.map(item => item.id), [aliceActive]);
  assert.equal((await list(bob, '?listener=online')).items.length, 0);
  const suspended = await list(admin, '?status=suspended&limit=1');
  assert.equal(suspended.items.length, 1);
  assert.equal(suspended.items[0]!.status, 'suspended');
  assert(suspended.next);
  const next = await list(admin, '?status=suspended&limit=1&after=' + encodeURIComponent(suspended.next));
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0]!.status, 'suspended');
  assert.notEqual(next.items[0]!.id, suspended.items[0]!.id);
  assert.equal(next.next, null);
  assert.deepEqual(await list(admin, '?status='), { items: [], next: null });
  value(disconnect(ctx, alice.human, aliceActive, {}));
  assert.deepEqual((await list(admin, '?listener=disconnecting')).items.map(item => item.id), [aliceActive]);
  assert.equal((await list(admin, '?listener=offline')).items.length, 3);
  for (const query of ['?status=all', '?status=active&status=revoked', '?listener=online&listener=offline',
    '?owner=' + bob.human.id, '?limit=1&limit=2', '?unknown=true']) {
    assert.equal((await fetch(origin + '/_coord/agents' + query, { headers: alice.headers })).status, 400, query);
  }
  const settings = queries.readPolicy(store)!;
  const update = { ...settings, agentInstructions: 'Administrator-authored project guidance.' };
  async function save(viewer: typeof alice, input: unknown, csrf: string) {
    return fetch(origin + '/_coord/policy', { method: 'PATCH', headers: { ...viewer.headers, Origin: origin,
      'Content-Type': 'application/json', 'X-Crossfire-CSRF': csrf }, body: JSON.stringify(input) });
  }
  assert.equal((await save(alice, update, 'fixture-csrf')).status, 403);
  assert.equal((await save(admin, update, 'wrong')).status, 403);
  assert.equal((await save(admin, update, 'fixture-csrf')).status, 200);
  assert.equal((await save(admin, update, 'fixture-csrf')).status, 409);
  const visible = await fetch(origin + '/_coord/policy', { headers: alice.headers });
  assert.equal(visible.status, 200);
  assert.equal((await visible.json() as { agentInstructions: string }).agentInstructions, update.agentInstructions);
  const deliveryPath = '/_coord/agents/' + aliceActive + '/delivery';
  const identity = queries.agent(store, aliceActive)!.userId;
  const delivery = await fetch(origin + deliveryPath, { headers: { Authorization: 'Bearer ' + identity } });
  assert.equal(delivery.status, 200);
  const parsed = value(deliveryPolicy(await delivery.json()));
  assert.equal(parsed.wakePolicy, 'owner'); assert.deepEqual(parsed.senders, [alice.human.id]);
  assert.equal((await fetch(origin + deliveryPath, { headers: { Authorization: 'Bearer ' + queries.agent(store, aliceRevoked)!.userId } })).status, 404);
  assert.equal((await fetch(origin + deliveryPath, { headers: { Authorization: 'Bearer ' + alice.human.id } })).status, 404);
  assert.equal((await fetch(origin + deliveryPath, { headers: { ...alice.headers, Authorization: 'Bearer ' + identity } })).status, 400);
  const wakeUpdate = { revision: queries.agent(store, aliceActive)!.revision, wakePolicy: 'humans' };
  async function changeWake(viewer: typeof alice, csrf: string) {
    return fetch(origin + '/_coord/agents/' + aliceActive, { method: 'PATCH', headers: { ...viewer.headers, Origin: origin,
      'Content-Type': 'application/json', 'X-Crossfire-CSRF': csrf }, body: JSON.stringify(wakeUpdate) });
  }
  assert.equal((await changeWake(bob, 'fixture-csrf')).status, 404);
  assert.equal((await changeWake(alice, 'wrong')).status, 403);
  assert.equal((await changeWake(admin, 'fixture-csrf')).status, 403);
  assert.equal((await changeWake(alice, 'fixture-csrf')).status, 200);
  assert.equal((await changeWake(alice, 'fixture-csrf')).status, 409);
  const refreshed = await fetch(origin + deliveryPath, { headers: { Authorization: 'Bearer ' + identity } });
  assert.equal(value(deliveryPolicy(await refreshed.json())).wakePolicy, 'humans');
});
