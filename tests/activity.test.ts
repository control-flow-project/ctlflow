import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { openStore } from '../apps/server/src/data/database.js';
import * as queries from '../apps/server/src/data/queries.js';
import { context, hash, secret } from '../apps/server/src/context.js';
import { requestEnrollment, decide } from '../apps/server/src/enrollment.js';
import { changeAgent, agentView } from '../apps/server/src/management.js';
import { activity, heartbeat, disconnect } from '../apps/server/src/activity.js';
import { LISTENER_EXPIRY_MS, parseActivity, emptyActivity } from '../packages/contracts/src/activity.js';
import { success, failure, type Result } from '../packages/contracts/src/result.js';
import { httpService } from '../apps/server/src/http.js';
import { releaseFixture, updatedRelease } from './release-fixture.js';
import { builtRelease } from '../scripts/test-support/release.js';

function value<T>(result: Result<T>): T { assert(result.ok, JSON.stringify(result)); return result.value; }

function fixture(path = ':memory:') {
  let now = 1_000_000;
  const store = openStore(path);
  const ctx = context(store, { instance: 'tests', serverName: 'tests.localhost', publicOrigin: 'http://127.0.0.1',
    matrixOrigin: 'http://127.0.0.1', administrator: '@admin:tests.localhost', registrationSecret: secret(), jwtSecret: secret() }, () => now);
  const credential = secret();
  const human = { id: ctx.config.administrator, sessionHash: hash(credential) };
  queries.insertSession(store, { hash: human.sessionHash, member: human.id, token: 'human', csrf: 'csrf', expires: now + 1_000_000 });
  const request = value(requestEnrollment(ctx, { owner: human.id, name: 'Agent' })) as { id: string; code: string };
  const approved = value(decide(ctx, human, request.id, { decision: 'approve', code: request.code })) as { agent: string };
  const agent = queries.agent(store, approved.agent)!;
  return { ctx, human, agent, credential, advance: (elapsed: number) => { now += elapsed; } };
}

test('Tinqer listener activity expires, counts cumulative receipts once and preserves observed duration', () => {
  const { ctx, human, agent, advance } = fixture();
  const current = builtRelease().release.manifest;
  const beat = (input: Record<string, unknown>) => heartbeat(ctx, agent.id, { release: current.release, ...input }, current);
  try {
    assert.deepEqual(activity(ctx, agent.id), emptyActivity());
    const run = randomUUID();
    value(beat({ run, messages: 0, stopped: false }));
    advance(30_000);
    value(beat({ run, messages: 3, stopped: false }));
    value(beat({ run, messages: 3, stopped: false }));
    value(beat({ run, messages: 1, stopped: false }));
    assert.equal(activity(ctx, agent.id).messages, 3);
    assert.equal(activity(ctx, agent.id).activeMs, 30_000);
    assert.equal(activity(ctx, agent.id).status, 'online');
    advance(LISTENER_EXPIRY_MS);
    assert.equal(activity(ctx, agent.id).status, 'offline');
    advance(1000);
    value(beat({ run, messages: 4, stopped: false }));
    assert.equal(activity(ctx, agent.id).activeMs, 30_000, 'Offline gap is not active time');
    const second = randomUUID();
    value(beat({ run: second, messages: 2, stopped: false }));
    assert.equal(activity(ctx, agent.id).listeners, 2);
    value(disconnect(ctx, human, agent.id, {}));
    assert.equal(activity(ctx, agent.id).status, 'disconnecting');
    assert.deepEqual(value(beat({ run, messages: 4, stopped: false })), { disconnect: true, current });
    value(beat({ run, messages: 5, stopped: true }));
    value(beat({ run: second, messages: 2, stopped: true }));
    assert.equal(activity(ctx, agent.id).messages, 7);
    assert.equal(activity(ctx, agent.id).status, 'offline');
    assert.deepEqual(value(beat({ run, messages: 999, stopped: false })), { disconnect: true, current });
    assert.equal(activity(ctx, agent.id).messages, 7);
    const reconnected = randomUUID();
    value(beat({ run: reconnected, messages: 0, stopped: false }));
    assert.equal(activity(ctx, agent.id).status, 'online', 'Explicit new run does not inherit an old disconnect');
    value(changeAgent(ctx, human, agent.id, { revision: agent.revision, status: 'suspended' }));
    assert.equal(activity(ctx, agent.id).status, 'offline');
    assert.equal(beat({ run, messages: 4, stopped: false }).ok, false);
    value(beat({ run: reconnected, messages: 0, stopped: true }));
    value(changeAgent(ctx, human, agent.id, { revision: agent.revision + 1, status: 'active' }));
    assert.equal(activity(ctx, agent.id).status, 'offline', 'Reactivation cannot revive a stopped listener');
    assert(parseActivity(agentView(ctx, queries.agent(ctx.store, agent.id)!).activity).ok);
    for (const invalid of [{ run, messages: -1, stopped: false }, { run, messages: 1.2, stopped: false }, { run, messages: 1, stopped: false, tokens: 1 }]) {
      assert.equal(beat(invalid).ok, false);
    }
  } finally { ctx.native.close(); ctx.store.close(); }
});

test('HTTP heartbeat is bound to native agent identity; disconnect requires its owner or administrator and CSRF', async scope => {
  const fixture_ = fixture();
  const { agent, human } = fixture_;
  const ctx = { ...fixture_.ctx, native: { ...fixture_.ctx.native, identify: async (token: string) => token === 'agent' ? success(agent.userId)
    : token === 'human' ? success(human.id) : token === 'other' ? success('@other:tests.localhost') : failure<string>('unauthorized', 'Invalid native token') } };
  const release = await releaseFixture();
  const server = httpService(ctx, { wake() {}, drain: async () => {}, stop: async () => {} }, release);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;
  ctx.config.publicOrigin = origin;
  scope.after(async () => { ctx.native.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); ctx.store.close(); });
  const path = '/_coord/agents/' + agent.id;
  async function post(suffix: string, headers: Record<string, string>, input: unknown) {
    return fetch(origin + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
  }
  const beat = { run: randomUUID(), release: release.manifest.release, messages: 1, stopped: false };
  for (const token of ['bad', 'human', 'other']) assert.notEqual((await post(path + '/heartbeat', { Authorization: 'Bearer ' + token }, beat)).status, 200);
  assert.equal((await post('/_coord/agents/' + randomUUID() + '/heartbeat', { Authorization: 'Bearer agent' }, beat)).status, 404);
  assert.equal((await post(path + '/heartbeat', { Authorization: 'Bearer agent', Cookie: 'crossfire=human-cookie' }, beat)).status, 400);
  assert.equal((await post(path + '/heartbeat', { Authorization: 'Bearer agent', Origin: 'https://wrong.invalid' }, beat)).status, 403);
  assert.equal((await post(path + '/heartbeat', { Authorization: 'Bearer agent' }, beat)).status, 200);
  assert.equal((await post(path + '/disconnect', { Authorization: 'Bearer agent' }, {})).status, 403);
  assert.equal((await post(path + '/disconnect', { Cookie: 'crossfire=human-cookie', Origin: origin }, {})).status, 403);
  const auth = { Cookie: 'crossfire=' + fixture_.credential, Origin: origin, 'X-Crossfire-CSRF': 'csrf' };
  assert.equal((await post(path + '/disconnect', auth, { arbitrary: true })).status, 400);
  assert.equal((await post(path + '/disconnect', auth, {})).status, 200);
  assert.deepEqual(await (await post(path + '/heartbeat', { Authorization: 'Bearer agent' }, beat)).json(), { disconnect: true, current: release.manifest });
  assert.equal((await fetch(origin + '/_coord/rooms/eligible', { headers: auth })).status, 404);
});

test('listener registration requires current software, preserves running versions and rejects in-place version changes', () => {
  const { ctx, human, agent } = fixture();
  const original = builtRelease().release;
  const current = updatedRelease(original, 'SKILL.md', '# Updated skill\n').manifest;
  const run = randomUUID();
  const input = { run, release: original.manifest.release, stopped: false, messages: 0 };
  try {
    const missing = heartbeat(ctx, agent.id, { run, stopped: false, messages: 0 }, current);
    assert(!missing.ok && /update.*skills/is.test(missing.error.message));
    const stale = heartbeat(ctx, agent.id, input, current);
    assert(!stale.ok);
    assert.match(stale.error.message, new RegExp(current.release));
    assert(stale.error.message.includes('/onboarding/' + current.release + '/SKILL.md'));
    assert.equal(activity(ctx, agent.id).listeners, 0);
    value(heartbeat(ctx, agent.id, input, original.manifest));
    assert.deepEqual(value(heartbeat(ctx, agent.id, input, current)), { disconnect: false, current });
    const running = activity(ctx, agent.id);
    assert.equal(running.runs[0]!.release, original.manifest.release);
    assert.equal(running.lastRelease, original.manifest.release);
    assert(parseActivity(running).ok);
    assert(!heartbeat(ctx, agent.id, { ...input, release: current.release }, current).ok);
    assert(!heartbeat(ctx, agent.id, { ...input, run: randomUUID() }, current).ok);
    value(disconnect(ctx, human, agent.id, {}));
    assert.equal(value(heartbeat(ctx, agent.id, input, current)).disconnect, true);
    value(heartbeat(ctx, agent.id, { ...input, stopped: true }, current));
    value(heartbeat(ctx, agent.id, { ...input, run: randomUUID(), release: current.release }, current));
    assert.equal(activity(ctx, agent.id).runs[0]!.release, current.release);
  } finally { ctx.native.close(); ctx.store.close(); }
});

test('listener version migration preserves activity and reports unrecorded historical versions honestly', () => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const path = join(mkdtempSync(join(process.cwd(), '.temp/listener-version-schema-')), 'management.sqlite');
  const { ctx, agent } = fixture(path);
  const current = builtRelease().release.manifest;
  const input = { run: randomUUID(), release: current.release, stopped: false, messages: 7 };
  value(heartbeat(ctx, agent.id, input, current));
  ctx.store.exec('ALTER TABLE listeners DROP COLUMN release');
  ctx.native.close(); ctx.store.close();
  const migrated = fixture(path);
  try {
    const preserved = activity(migrated.ctx, agent.id);
    assert.equal(preserved.messages, 7);
    assert.equal(preserved.runs[0]!.release, null);
    assert(parseActivity(preserved).ok);
    migrated.advance(1000);
    value(heartbeat(migrated.ctx, agent.id, { ...input, run: randomUUID(), messages: 0 }, current));
    assert.equal(activity(migrated.ctx, agent.id).lastRelease, current.release);
    assert.equal(activity(migrated.ctx, agent.id).messages, 7);
  } finally { migrated.ctx.native.close(); migrated.ctx.store.close(); }
  const reopened = fixture(path);
  try { assert.equal(activity(reopened.ctx, agent.id).lastRelease, current.release); }
  finally { reopened.ctx.native.close(); reopened.ctx.store.close(); }
});
