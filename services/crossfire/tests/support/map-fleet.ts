import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { randomUUID } from 'node:crypto';
import type { Actor, Services } from '@ctlflow/crossfire-domain/port/services';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { value, secret } from './application.js';

export async function mapFleet(services: Services, owner: Actor, ownerMatrixId: string, count = 24) {
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId, fleetKey: 'map-fleet',
    controller: { name: 'Map workstation', metadata: {} },
    instances: Array.from({ length: count }, (_, index) => ({ instanceKey: 'worker-' + String(index).padStart(2, '0'), name: 'map-worker-' + index, coordinationPolicy: defaultCoordinationPolicy() })) };
  const introduced = value(await introduceEnrollment(services, input));
  value(decideEnrollment(services, owner, input.enrollmentId,
    { expectedRevision: 0, verificationCode: introduced.request.verificationCode, decision: 'approve' }, randomUUID()));
  const instances = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }));
  for (const instance of instances) value(await reconcilePrincipal(services, instance.agentId!));
  const ready = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
  const fleet = value(services.repositories.fleet.find({ ownerId: owner.principalId, fleetKey: input.fleetKey }))!;
  return { fleet, instances, ready };
}
