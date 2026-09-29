import { failure, success, type Result } from '@crossfire/kernel/result';
import { controllerToken } from '../fleet/authority.js';
import type { Services } from '../port/services.js';
export type ExchangedInstance = { instanceKey: string; name: string; agentId: string | null; status: 'ready' | 'provisioning' | 'failed'; errorCode: string | null;
  account: { matrixUserId: string; accessToken: string; deviceId: string } | null };
export function exchangeEnrollment(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock'>,
  enrollmentId: string, claimSecret: string): Result<{ status: string; ownerMatrixId: string; fleet: { fleetId: string; controllerCredential: string | null } | null; instances: ExchangedInstance[] }> {
  const request = services.repositories.enrollmentRequest.find({ id: enrollmentId });
  if (!request.ok) return request;
  if (!request.value || request.value.expiresAt <= services.clock.now() || !services.identity.matches(claimSecret, request.value.claimHash)) return failure('unauthorized', 'Invalid or expired enrollment claim');
  const owner = services.repositories.principal.find({ id: request.value.ownerId });
  if (!owner.ok) return owner;
  if (!owner.value || owner.value.status !== 'active') return failure('forbidden', 'Owner access is no longer active');
  if (request.value.status !== 'approved') return success({ status: request.value.status, ownerMatrixId: owner.value.matrixUserId, fleet: null, instances: [] });
  const items = services.collection.enrollmentItems({ requestId: enrollmentId });
  if (!items.ok) return items;
  const instances: ExchangedInstance[] = [];
  for (const item of items.value) {
    const base = { instanceKey: item.instanceKey, name: item.requestedName, agentId: item.agentId };
    if (item.outcome === 'failed') { instances.push({ ...base, status: 'failed', errorCode: item.failureCode, account: null }); continue; }
    if (item.agentId === null) return failure('unavailable', 'Approved identity is not assigned');
    const agent = services.directory.agent(item.agentId);
    const credentials = services.repositories.agentCredential.find({ agentId: item.agentId });
    if (!agent.ok) return agent; if (!credentials.ok) return credentials;
    if (!agent.value || !credentials.value || agent.value.principal.status !== 'active' || agent.value.owner.status !== 'active') return failure('forbidden', 'Agent access is no longer active');
    const ready = credentials.value.accessToken !== null && agent.value.application.appliedStatus === 'active' && agent.value.application.errorCode === null;
    instances.push({ ...base, status: ready ? 'ready' : 'provisioning', errorCode: agent.value.application.errorCode,
      account: ready ? { matrixUserId: agent.value.principal.matrixUserId, accessToken: credentials.value.accessToken!, deviceId: 'CROSSFIRE_AGENT' } : null });
  }
  let fleet: { fleetId: string; controllerCredential: string | null } | null = null;
  if (request.value.fleetKey !== null) {
    const found = services.repositories.fleet.find({ ownerId: request.value.ownerId, fleetKey: request.value.fleetKey });
    if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Fleet no longer exists');
    const credential = services.repositories.fleetCredential.find({ id: enrollmentId });
    if (!credential.ok) return credential;
    fleet = { fleetId: found.value.id, controllerCredential: credential.value?.revokedAt === null ? controllerToken(services, enrollmentId, claimSecret) : null };
  }
  return success({ status: instances.some(item => item.status === 'provisioning') ? 'provisioning' : 'ready', ownerMatrixId: owner.value.matrixUserId, fleet, instances });
}
