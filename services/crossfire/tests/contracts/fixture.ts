import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { contractProcess, freePorts, list, observe, record, text, type ContractProcess, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { contractHttp, contractData, type ContractReply } from '@ctlflow/crossfire-test-support/contract-http';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { decodeResponse, decodeFailure } from '@ctlflow/crossfire-contracts/rest/envelope';
import type { Parser } from '@ctlflow/crossfire-contracts/schema/validation';
import { conduitFixture } from '../../node/scripts/architecture-proof/conduit-fixture.js';
import { builtRelease } from '../../node/scripts/test-support/release.js';
import { secureProxy } from '../../node/tests/support/tls.js';

type ContractOperation = { method: string; path: string; status: number; collection: boolean; output: Parser<unknown> };
export type ContractSession = { nativeToken: string; cookie: string; csrf: string; matrixUserId: string; memberId: string };
export type ContractStack = Awaited<ReturnType<typeof contractClient>>;
export async function contractStack(scope: TestContext, initial: ContractTarget, targets: readonly ContractTarget[]) {
  const secret = () => randomBytes(32).toString('base64url'); const jwtSecret = secret(); const native = await conduitFixture(scope, { jwtSecret }); const serverName = 'architecture.localhost';
  const directory = mkdtempSync(join(tmpdir(), 'cf-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const state = join(directory, 'state'); mkdirSync(state, { mode: 0o700 }); const [port, contentPort] = await freePorts(); const { origin } = await secureProxy(scope, 'http://127.0.0.1:' + port); const contentOrigin = 'http://localhost:' + contentPort;
  const bootstrap = { servicePassword: secret(), administratorPassword: secret() }; const configuration = { instance: 'contracts', serverName, publicOrigin: origin, contentOrigin, matrixOrigin: native.base,
    administrator: '@admin:' + serverName, jwtSecret, registrationSecret: native.registrationToken, trustedProxyAddresses: ['127.0.0.1'] };
  writeFileSync(join(state, 'config.json'), JSON.stringify(configuration), { mode: 0o600 }); writeFileSync(join(state, 'bootstrap.json'), JSON.stringify(bootstrap), { mode: 0o600 }); await migrateDatabase(join(state, 'management.sqlite'));
  const release = builtRelease(); const web = join(process.cwd(), 'dist/web'); const element = join(directory, 'element'); mkdirSync(element, { mode: 0o700 }); writeFileSync(join(element, 'index.html'), '<!doctype html><title>Isolated Element asset fixture</title>');
  let selected = initial, running: ContractProcess | undefined;
  async function start(target: ContractTarget) {
    selected = target; running = contractProcess(scope, target.server, ['serve', state, release.directory, web, element, String(port), String(contentPort)], directory);
    await observe(async () => { assert.equal(running?.alive(), true, running?.errors() || running?.output() || 'Server must remain running'); try { return (await contractHttp(origin, 'GET', '/api/health')).status === 200; } catch { return false; } }, 'Selected backend must become ready: ' + target.name, 60000);
  }
  await start(initial);
  return { ...await contractClient({ directory, state, origin, contentOrigin, native, configuration, bootstrap, targets, release,
    restart: async (target = selected) => { await running?.close(); await start(target); },
    close: async () => { await running?.close(); }, current: () => selected }), backendOrigin: 'http://127.0.0.1:' + port };
}

type ContractHost = {
  directory: string; state: string; origin: string; contentOrigin: string; native: { base: string };
  configuration: { instance: string; serverName: string; publicOrigin: string; contentOrigin: string; matrixOrigin: string; administrator: string; jwtSecret: string; registrationSecret: string };
  bootstrap: { administratorPassword: string }; targets: readonly ContractTarget[]; release: ReturnType<typeof builtRelease>;
  restart(target?: ContractTarget): Promise<void>; close(): Promise<void>; current(): ContractTarget;
};
export async function contractClient(host: ContractHost) {
  const { directory, state, origin, contentOrigin, native, configuration, bootstrap, targets, release, restart, close, current } = host;
  const secret = () => randomBytes(32).toString('base64url');
  const successful = new Set<string>();
  function observed(operation: ContractOperation, response: ContractReply) {
    const parsed = decodeResponse(response.body, operation.output, operation.collection);
    assert(parsed.ok, operation.path + ': ' + (parsed.ok ? '' : parsed.error.message));
    successful.add(operation.method + ' ' + operation.path);
    return parsed.value;
  }
  async function login(username: string, password: string): Promise<ContractSession> {
    const nativeLogin = await contractHttp(native.base, 'POST', '/_matrix/client/v3/login', { type: 'm.login.password', identifier: { type: 'm.id.user', user: username }, password }); assert.equal(nativeLogin.status, 200, JSON.stringify(nativeLogin.body)); const account = record(nativeLogin.body);
    const sessionReply = await contractHttp(origin, 'POST', '/api/sessions', { nativeAccessToken: text(account.access_token) }, { Origin: origin }); const data = contractData(sessionReply, 201); observed(operations.createSession, sessionReply); const member = record(data.member); const cookie = sessionReply.headers['set-cookie']; assert(Array.isArray(cookie) && cookie.length === 1); assert.match(cookie[0]!, /HttpOnly; SameSite=Strict; Secure/u); assert(!cookie[0]!.toLowerCase().includes('domain='));
    return { nativeToken: text(account.access_token), cookie: cookie[0]!.split(';')[0]!, csrf: text(data.csrfSecret), matrixUserId: text(account.user_id), memberId: text(member.memberId) };
  }
  const owner = await login('admin', bootstrap.administratorPassword);
  const headers = (session = owner) => ({ Cookie: session.cookie, Origin: origin, 'X-Crossfire-CSRF': session.csrf });
  async function operation(operation: ContractOperation, parameters: Record<string, string> = {}, input?: unknown, identity: ContractSession | string = owner, query = '') {
    const path = operation.path.replace(/\{([A-Za-z]+)\}/gu, (_match, key: string) => encodeURIComponent(parameters[key] ?? assert.fail('Missing ' + key))); const response = await contractHttp(origin, operation.method, path + query,
      operation.method === 'GET' ? undefined : input ?? {}, typeof identity === 'string' ? { Authorization: 'Bearer ' + identity } : headers(identity));
    assert.equal(response.status, operation.status, operation.path + ': ' + JSON.stringify(response.body).slice(0, 2048)); return observed(operation, response);
  }
  async function failure(reply: ContractReply, status: number, code: string) { assert.equal(reply.status, status, JSON.stringify(reply.body).slice(0, 1024)); const result = decodeFailure(reply.body); assert(!result.ok); assert.equal(result.error.code, code); }
  async function member(username: string) {
    const invitation = record((await operation(operations.createInvitation, {}, { roleCode: 'member', expiresSeconds: 600 })).data); const password = secret();
    const claim = await contractHttp(origin, 'POST', '/api/member-invitations/' + text(invitation.invitationId) + '/claim', { claimSecret: text(invitation.claimSecret) }, { Origin: origin }); assert.equal(claim.status, 200, JSON.stringify(claim.body)); observed(operations.claimInvitation, claim); const cookies = claim.headers['set-cookie']; assert(Array.isArray(cookies) && cookies.length === 1); const cookie = cookies[0]!.split(';')[0]!;
    const details = { username, password, device_id: 'SHARED_CONTRACT' }; const challenge = await contractHttp(origin, 'POST', '/_matrix/client/v3/register', details, { Origin: origin }); assert.equal(challenge.status, 401); const session = text(record(challenge.body).session); const fallback = '/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web?session=' + encodeURIComponent(session);
    const review = await contractHttp(origin, 'GET', fallback, undefined, { Cookie: cookie }); assert.equal(review.status, 200, JSON.stringify(review.body)); const nonce = /name="nonce" value="([^"]+)"/u.exec(text(review.body))?.[1]; assert(nonce, 'Exact registration confirmation nonce');
    const accepted = await contractHttp(origin, 'POST', fallback, 'nonce=' + encodeURIComponent(nonce), { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }); assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const complete = await contractHttp(origin, 'POST', '/_matrix/client/v3/register', { auth: { type: 'org.crossfire.login.registration', session } }, { Origin: origin }); assert.equal(complete.status, 200, JSON.stringify(complete.body)); return login(username, password);
  }
  async function agent(name = 'contract-analyst') {
    const enrollmentId = randomUUID(), claimSecret = secret(); const introduced = record((await operation(operations.introduceEnrollment, {}, { enrollmentId, claimSecret, ownerMatrixId: owner.matrixUserId,
      fleetKey: name, controller: { name: 'Shared contracts' }, instances: [{ instanceKey: name, name, coordinationPolicy: { wakeMode: 'selected', senders: [{ matrixUserId: owner.matrixUserId, includeAgents: true }], permissions: ['room.agent.invite'] } }] })).data);
    await operation(operations.decideEnrollment, { enrollmentId }, { expectedRevision: 0, decision: 'approve', verificationCode: text(record(record(introduced.enrollment).enrollment).verificationCode) });
    let ready: Record<string, unknown> = {}; await observe(async () => { ready = record((await operation(operations.exchangeEnrollment, { enrollmentId }, { claimSecret })).data); return ready.status === 'ready'; }, 'Approved enrollment must reconcile through actual Matrix');
    const enrolled = record(list(ready.instances)[0]); const account = record(enrolled.account); const fleet = record(ready.fleet); return { id: text(enrolled.agentId), name, matrixUserId: text(account.matrixUserId), token: text(account.accessToken), fleetId: text(fleet.fleetId), credential: text(fleet.controllerCredential), connectionId: randomUUID(), enrollmentId, claimSecret };
  }
  return { directory, state, origin, contentOrigin, native, configuration, owner, targets, release, headers, operation, login, member, agent, failure, restart,
    assertOperationCoverage() { assert.deepEqual(Object.entries(operations).filter(([_name, operation]) => !successful.has(operation.method + ' ' + operation.path)).map(([name]) => name), [], 'Every canonical operation needs a successful wire-schema-validated shared scenario'); },
    async approve(enrollmentId: string, code: string) { await operation(operations.decideEnrollment, { enrollmentId }, { expectedRevision: 0, decision: 'approve', verificationCode: code }); },
    close, current,
    async raw(path: string, method = 'GET', input?: unknown, custom: Record<string, string> = {}) { return contractHttp(origin, method, path, input, custom); },
    async data(operationValue: ContractOperation, parameters: Record<string, string> = {}, input?: unknown, identity: ContractSession | string = owner, query = '') { return record((await operation(operationValue, parameters, input, identity, query)).data); } };
}
