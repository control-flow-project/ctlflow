import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import { createApplication } from '../../apps/server/src/composition.js';
import { createSession } from '@crossfire/domain/session/create-session';
import { authenticateMember } from '@crossfire/domain/session/authenticate';
import { registerPrincipal } from '@crossfire/domain/principal/register';
import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';
import { decideEnrollment } from '@crossfire/domain/enrollment/decide';
import { reconcilePrincipal } from '@crossfire/domain/principal/reconcile';
import { exchangeEnrollment } from '@crossfire/domain/enrollment/exchange';
import { success, type Result } from '@crossfire/kernel/result';
import type { Actor } from '@crossfire/domain/port/services';
import { matrixAuthorityFixture } from './matrix-authority.js';
export function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.code + ': ' + result.error.message); return result.value; }
export function secret(): string { return randomBytes(32).toString('base64url'); }
export async function applicationFixture(scope: TestContext, databasePath = ':memory:') {
  let now = 1_800_000_000_000;
  const native = matrixAuthorityFixture();
  const config = { instance: 'tests', serverName: 'test.localhost', publicOrigin: 'http://127.0.0.1', contentOrigin: 'http://localhost', matrixOrigin: 'http://127.0.0.1',
    administrator: '@admin:test.localhost', jwtSecret: secret(), registrationSecret: secret() };
  const adminNative = value(await native.matrix.provision(config.administrator, secret(), 'test'));
  const application = createApplication(databasePath, config, { now: () => now, matrix: native.matrix });
  cleanup(scope, () => application.close());
  const { services } = application;
  async function login(token: string) {
    const session = value(await createSession(services, token)), authenticated = value(await authenticateMember(services, session.secret));
    return { ...session, actor: authenticated.actor, token };
  }
  const admin = await login(adminNative.accessToken);
  async function member(name: string) {
    const account = value(await native.matrix.provision('@' + name + ':' + config.serverName, secret(), 'test'));
    const id = randomUUID();
    value(services.unitOfWork.run(() => {
      const registered = registerPrincipal(services, { id, matrixUserId: account.userId, kind: 'human', status: 'active', revision: 0, createdAt: now }, 'member', admin.actor.principalId);
      if (!registered.ok) return registered;
      return services.repositories.member.insert({ principalId: id, principalKind: 'human', displayName: name });
    }));
    return login(account.accessToken);
  }
  async function agent(owner: Actor, name: string) {
    const ownerRecord = value(services.directory.member(owner.principalId))!;
    const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: ownerRecord.principal.matrixUserId,
      fleetKey: null, instances: [{ instanceKey: name, name }] };
    const introduced = value(await introduceEnrollment(services, input));
    value(decideEnrollment(services, owner, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
    const item = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }))[0]!;
    assert(item.agentId);
    value(await reconcilePrincipal(services, item.agentId));
    const exchanged = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
    assert.equal(exchanged.status, 'ready');
    const account = exchanged.instances[0]!.account!;
    return { id: item.agentId, matrixUserId: account.matrixUserId, token: account.accessToken, actor: { principalId: item.agentId, kind: 'agent' as const } };
  }
  return { application, services, native, admin, member, agent, advance(milliseconds: number) { now += milliseconds; }, now: () => now, ok: success };
}
