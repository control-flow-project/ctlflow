import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { EnrollmentRoster } from './input.js';
import { authenticateController } from '../fleet/authority.js';
import { validateRoster } from './input.js';
import { enrollmentCapacity } from './capacity.js';
import { resolveCoordinationPolicy } from '../fleet/policy.js';
import type { RequestedFleetPolicy } from '../port/fleet-policy.js';

export type VerifiedRoster = { ownerId: string; ownerRevision: number; existing: { instanceKey: string; agentId: string; revision: number }[];
  policies: { instanceKey: string; policy: RequestedFleetPolicy }[] };
export async function verifyRoster(services: Pick<Services, 'repositories' | 'directory' | 'matrix' | 'identity' | 'collection'>, input: EnrollmentRoster): Promise<Result<VerifiedRoster>> {
  const valid = validateRoster(input);
  if (!valid.ok) return valid;
  const owner = services.directory.principalByMatrixId(input.ownerMatrixId);
  if (!owner.ok) return owner;
  if (!owner.value || owner.value.kind !== 'human' || owner.value.status !== 'active') return failure('forbidden', 'An active human owner is required');
  if (input.fleetKey !== null) {
    const fleet = services.repositories.fleet.find({ ownerId: owner.value.id, fleetKey: input.fleetKey });
    if (!fleet.ok) return fleet;
    if (fleet.value) {
      const controller = authenticateController(services, input.controllerCredential ?? '');
      if (!controller.ok) return controller;
      if (controller.value.fleetId !== fleet.value.id) return failure('forbidden', 'Controller credential belongs to another fleet');
    } else if (input.controllerCredential !== undefined) return failure('invalid', 'Controller credential has no fleet');
  }
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
  const policies: VerifiedRoster['policies'] = [];
  for (const item of input.instances) {
    if (!item.coordinationPolicy) continue;
    const identity = existing.find(proof => proof.instanceKey === item.instanceKey);
    const resolved = resolveCoordinationPolicy(services, item.coordinationPolicy, identity?.agentId ?? null, identity?.revision ?? null);
    if (!resolved.ok) return resolved;
    policies.push({ instanceKey: item.instanceKey, policy: resolved.value });
  }
  return success({ ownerId: owner.value.id, ownerRevision: owner.value.revision, existing, policies });
}

export async function preflightEnrollment(services: Pick<Services, 'repositories' | 'directory' | 'matrix' | 'identity' | 'collection'>, input: EnrollmentRoster) {
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
  if (collisions.length) return failure('name_collision', 'Name collision: ' + collisions.join(', '));
  const capacity = enrollmentCapacity(services, verified.value.ownerId);
  if (!capacity.ok) return capacity;
  const additional = input.instances.length - verified.value.existing.length;
  if (additional > capacity.value.remaining) return failure('capacity', 'Enrollment needs ' + additional + ' new agents; owner capacity is '
    + capacity.value.ownerCount + '/' + capacity.value.ownerLimit + ' and instance capacity is '
    + capacity.value.instanceCount + '/' + capacity.value.policy.maxAgents + '. Ask an administrator to adjust the applicable limits.');
  return success({ available: true, instances: input.instances.length });
}
