import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { conduitFixture } from '../../scripts/architecture-proof/conduit-fixture.js';
import { createApplication } from '../../apps/server/src/composition.js';
import { createSession } from '@ctlflow/crossfire-domain/session/create-session';
import { authenticateMember } from '@ctlflow/crossfire-domain/session/authenticate';
import { createMemberInvitation } from '@ctlflow/crossfire-domain/member/invitation';
import { acceptMemberInvitation } from '@ctlflow/crossfire-domain/member/accept-invitation';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import type { Actor } from '@ctlflow/crossfire-domain/port/services';
import { value, secret } from './application.js';
export async function nativeApplication(scope: TestContext) {
  const started = performance.now();
  const jwtSecret = secret(), native = await conduitFixture(scope, { jwtSecret });
  const service = await native.register('crossfire-tests'), administrator = await native.register('admin');
  const config = { instance: 'tests', serverName: 'architecture.localhost', publicOrigin: 'http://127.0.0.1', contentOrigin: 'http://localhost', matrixOrigin: native.base,
    administrator: administrator.id, registrationSecret: native.registrationToken, jwtSecret };
  const application = createApplication(':memory:', config), { services } = application;
  cleanup(scope, () => application.close());
  async function login(token: string) {
    const session = value(await createSession(services, token)), authenticated = value(await authenticateMember(services, session.secret));
    return { ...session, actor: authenticated.actor, token };
  }
  const admin = await login(administrator.token);
  scope.diagnostic('Native application bootstrap: ' + Math.round(performance.now() - started) + 'ms');
  async function member(name: string) {
    const invitation = value(createMemberInvitation(services, admin.actor, { roleCode: 'member', expiresSeconds: 600 }, randomUUID()));
    const input = { claimSecret: invitation.claimSecret, username: name, password: secret(), displayName: name };
    const accepted = value(await acceptMemberInvitation(services, invitation.invitationId, input, randomUUID()));
    return { ...await login(accepted.account.accessToken), invitation, input, accepted };
  }
  async function agent(owner: Actor, name: string) {
    const ownerRecord = value(services.directory.member(owner.principalId))!;
    const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: ownerRecord.principal.matrixUserId,
      fleetKey: 'test-' + name, controller: { name: 'Native test controller' },
      instances: [{ instanceKey: name, name, coordinationPolicy: defaultCoordinationPolicy(ownerRecord.principal.matrixUserId) }] };
    const introduced = value(await introduceEnrollment(services, input));
    value(decideEnrollment(services, owner, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
    const item = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }))[0]!;
    value(await reconcilePrincipal(services, item.agentId!));
    const ready = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
    const controller = { fleetId: ready.fleet!.fleetId, connectionId: randomUUID(), credential: ready.fleet!.controllerCredential! };
    value(reportFleetConnection(services, value(authenticateController(services, controller.credential)), controller.fleetId, controller.connectionId, false));
    const account = ready.instances[0]!.account!;
    return { id: item.agentId!, matrixUserId: account.matrixUserId, token: account.accessToken, controller,
      actor: { principalId: item.agentId!, kind: 'agent' as const }, input };
  }
  return { application, services, native, service, admin, member, agent };
}
