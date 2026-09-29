import { failure, success, type Result } from '../../../kernel/src/result.js';
import type { Services } from '../port/services.js';
import type { EnrollmentRoster } from './input.js';
import { validateRoster } from './input.js';

export type VerifiedRoster = { ownerId: string; ownerRevision: number; existing: { instanceKey: string; agentId: string; revision: number }[] };
export async function verifyRoster(services: Pick<Services, 'repositories' | 'directory' | 'matrix'>, input: EnrollmentRoster): Promise<Result<VerifiedRoster>> {
  const valid = validateRoster(input);
  if (!valid.ok) return valid;
  const owner = services.directory.principalByMatrixId(input.ownerMatrixId);
  if (!owner.ok) return owner;
  if (!owner.value || owner.value.kind !== 'human' || owner.value.status !== 'active') return failure('forbidden', 'An active human owner is required');
  const existing: VerifiedRoster['existing'] = [];
  for (const item of input.instances) {
    if (input.fleetKey !== null) {
      const binding = services.repositories.fleetInstance.find({ ownerId: owner.value.id, fleetKey: input.fleetKey, instanceKey: item.instanceKey });
      if (!binding.ok) return binding;
      if (binding.value && binding.value.agentId !== item.identity?.agentId) return failure('conflict', 'Missing matching private credentials for saved fleet instance ' + item.instanceKey);
    }
    if (!item.identity) continue;
    const native = await services.matrix.identify(item.identity.accessToken);
    if (!native.ok) return native;
    const record = services.directory.agent(item.identity.agentId);
    if (!record.ok) return record;
    if (!record.value || record.value.principal.matrixUserId !== native.value || record.value.agent.ownerId !== owner.value.id
      || record.value.principal.status !== 'active' || record.value.owner.status !== 'active' || record.value.name !== item.name) return failure('forbidden', 'Existing identity proof does not match the active owner, agent and registered name');
    if (input.fleetKey !== null) {
      const binding = services.repositories.fleetInstance.find({ ownerId: owner.value.id, fleetKey: input.fleetKey, instanceKey: item.instanceKey });
      if (!binding.ok) return binding;
      if (binding.value && binding.value.agentId !== item.identity.agentId) return failure('conflict', 'Fleet instance is bound to a different identity: ' + item.instanceKey);
    }
    existing.push({ instanceKey: item.instanceKey, agentId: item.identity.agentId, revision: record.value.principal.revision });
  }
  return success({ ownerId: owner.value.id, ownerRevision: owner.value.revision, existing });
}

export async function preflightEnrollment(services: Pick<Services, 'repositories' | 'directory' | 'matrix'>, input: EnrollmentRoster) {
  const verified = await verifyRoster(services, input);
  if (!verified.ok) return verified;
  const collisions: string[] = [];
  for (const item of input.instances) {
    const name = services.repositories.agentName.find({ name: item.name });
    if (!name.ok) return name;
    if (name.value && !verified.value.existing.some(existing => existing.instanceKey === item.instanceKey && existing.agentId === name.value!.agentId)) collisions.push(item.name);
    if (input.fleetKey !== null) {
      const binding = services.repositories.fleetInstance.find({ ownerId: verified.value.ownerId, fleetKey: input.fleetKey, instanceKey: item.instanceKey });
      if (!binding.ok) return binding;
      if (binding.value && !verified.value.existing.some(existing => existing.instanceKey === item.instanceKey && existing.agentId === binding.value!.agentId)) return failure('conflict', 'Missing private credentials for saved fleet instance ' + item.instanceKey);
    }
  }
  return collisions.length ? failure('conflict', 'Name collision: ' + collisions.join(', ')) : success({ available: true, instances: input.instances.length });
}
