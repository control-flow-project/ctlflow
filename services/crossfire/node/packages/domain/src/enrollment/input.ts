import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { opaqueIdentifier } from '@ctlflow/crossfire-kernel/identifier';
import { validateCoordinationPolicy, type CoordinationPolicy } from '../fleet/coordination-policy.js';
export type EnrollmentIdentityProof = { agentId: string; accessToken: string };
export type EnrollmentEntry = { instanceKey: string; name: string; identity?: EnrollmentIdentityProof; coordinationPolicy: CoordinationPolicy };
export type ControllerDescriptor = { name: string; metadata?: Record<string, string> };
export type EnrollmentRoster = { controller: ControllerDescriptor; controllerCredential?: string; ownerBackendUserId: string; fleetKey: string; instances: EnrollmentEntry[] };
export type EnrollmentIntroduction = EnrollmentRoster & { enrollmentId: string; claimSecret: string };
export function validName(value: string): boolean { return /^[a-z][a-z0-9-]{0,39}$/u.test(value); }
export function validateController(controller: ControllerDescriptor) {
  if (!controller || typeof controller.name !== 'string' || !controller.name.trim() || controller.name.length > 100 || Object.entries(controller.metadata ?? {}).length > 16
    || Object.entries(controller.metadata ?? {}).some(([key, value]) => !validName(key) || typeof value !== 'string' || value.length > 256)) return failure('invalid', 'Invalid controller descriptor');
  return success(controller);
}
export function validateRoster(roster: EnrollmentRoster) {
  if (!opaqueIdentifier(roster.ownerBackendUserId) || typeof roster.fleetKey !== 'string' || !validName(roster.fleetKey)
    || !Array.isArray(roster.instances) || roster.instances.length < 1 || roster.instances.length > 100
    || roster.instances.some(item => !validName(item.instanceKey) || !validName(item.name))
    || new Set(roster.instances.map(item => item.instanceKey)).size !== roster.instances.length
    || new Set(roster.instances.map(item => item.name)).size !== roster.instances.length) return failure('invalid', 'Supply one owner and a unique roster of valid lowercase names and instance keys');
  if (!roster.controller) return failure('invalid', 'Enrollment requires a fleet controller');
  const controller = validateController(roster.controller); if (!controller.ok) return controller;
  for (const item of roster.instances) {
    if (!item.coordinationPolicy) return failure('invalid', 'Every instance requires an owner-reviewed coordination policy');
    const valid = validateCoordinationPolicy(item.coordinationPolicy); if (!valid.ok) return valid;
  }
  return success(roster);
}
