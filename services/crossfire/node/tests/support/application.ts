import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import { createApplication } from '../../apps/server/src/composition.js';
import { createSession } from '@ctlflow/crossfire-domain/session/create-session';
import { authenticateMember } from '@ctlflow/crossfire-domain/session/authenticate';
import { registerPrincipal } from '@ctlflow/crossfire-domain/principal/register';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import type { ControllerProof } from '@ctlflow/crossfire-domain/listener/controller';
import { success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Actor } from '@ctlflow/crossfire-domain/port/services';
import { matrixAuthorityFixture } from './matrix-authority.js';
import { applicationDatabase } from './storage.js';
import { backendHttp } from '../../apps/server/src/messaging.js';
export function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.code + ': ' + result.error.message); return result.value; }
export function secret(): string { return randomBytes(32).toString('base64url'); }
export async function applicationFixture(scope: TestContext, databasePath = ':memory:', logging: { loggingRetentionDays?: number } = {}) {
  let now = 1_800_000_000_000;
  const native = matrixAuthorityFixture();
  const config = { instance: 'tests', publicOrigin: 'http://127.0.0.1', contentOrigin: 'http://localhost',
    messaging: { type: 'matrix', parameters: { serverName: 'test.localhost', origin: 'http://127.0.0.1', jwtSecret: secret(), registrationSecret: secret() } },
    administrator: '@admin:test.localhost', ...logging };
  const adminNative = value(await native.messaging.provision(config.administrator, secret(), { deviceId: 'test' }));
  const application = createApplication(applicationDatabase(scope, databasePath), config, { now: () => now, backend: configuration => {
    return { http: backendHttp(configuration, 'test.localhost'), authority: native.messaging };
  } });
  cleanup(scope, () => application.close());
  const { services } = application;
  async function login(token: string) {
    const session = value(await createSession(services, token)), authenticated = value(await authenticateMember(services, session.secret));
    return { ...session, actor: authenticated.actor, token };
  }
  const admin = await login(adminNative.accessToken);
  function renewController(controller: ControllerProof) {
    const actor = value(authenticateController(services, controller.credential));
    const previous = value(services.repositories.fleetConnection.find(controller.fleetId));
    if (previous && (previous.closedAt !== null || previous.expiresAt <= now)) controller.connectionId = randomUUID();
    return value(reportFleetConnection(services, actor, controller.fleetId, controller.connectionId, false));
  }
  function advanceConnected(milliseconds: number, ...controllers: ControllerProof[]) {
    let remaining = milliseconds;
    while (remaining > 0) {
      for (const controller of controllers) renewController(controller);
      const step = Math.min(remaining, 20_000);
      now += step;
      remaining -= step;
    }
  }
  async function member(name: string) {
    const account = value(await native.messaging.provision('@' + name + ':test.localhost', secret(), { deviceId: 'test' }));
    const id = randomUUID();
    value(services.unitOfWork.run(() => {
      const registered = registerPrincipal(services, { id, backendUserId: account.userId, kind: 'human', status: 'active', revision: 0, createdAt: now }, 'member', admin.actor.principalId);
      if (!registered.ok) return registered;
      return services.repositories.member.insert({ principalId: id, principalKind: 'human', displayName: name });
    }));
    return login(account.accessToken);
  }
  async function agent(owner: Actor, name: string) {
    const ownerRecord = value(services.directory.member(owner.principalId))!;
    const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: ownerRecord.principal.backendUserId,
      fleetKey: 'test-' + name, controller: { name: 'Test controller' },
      instances: [{ instanceKey: name, name, coordinationPolicy: defaultCoordinationPolicy(ownerRecord.principal.backendUserId) }] };
    const introduced = value(await introduceEnrollment(services, input));
    value(decideEnrollment(services, owner, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
    const item = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }))[0]!;
    assert(item.agentId);
    value(await reconcilePrincipal(services, item.agentId));
    const exchanged = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
    assert.equal(exchanged.status, 'ready');
    assert(exchanged.fleet?.controllerCredential);
    const controller = { fleetId: exchanged.fleet.fleetId, connectionId: randomUUID(), credential: exchanged.fleet.controllerCredential };
    renewController(controller);
    const account = exchanged.instances[0]!.account!;
    return { id: item.agentId, backendUserId: account.userId, token: account.accessToken, controller,
      actor: { principalId: item.agentId, kind: 'agent' as const } };
  }
  function listen(instance: Awaited<ReturnType<typeof agent>>, release = 'test', runId = randomUUID()) {
    value(reportListener(services, instance.actor, instance.id, runId, { statistics: null, release, messagesDelivered: 0, stopped: false, controller: instance.controller }, release));
    return { runId, sessionId: 'native-session' };
  }
  async function listeningAgent(owner: Actor, name: string, release = 'test') {
    const instance = await agent(owner, name);
    listen(instance, release);
    return instance;
  }
  return { application, services, native, admin, member, agent, listeningAgent, listen, renewController, advanceConnected, advance(milliseconds: number) { now += milliseconds; }, now: () => now, ok: success };
}
