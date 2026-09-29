import { failure, success } from '@crossfire/kernel/result';
export type EnrollmentIdentityProof = { agentId: string; accessToken: string };
export type EnrollmentEntry = { instanceKey: string; name: string; identity?: EnrollmentIdentityProof };
export type ControllerDescriptor = { name: string; metadata?: Record<string, string> };
export type EnrollmentRoster = { controller?: ControllerDescriptor; controllerCredential?: string; ownerMatrixId: string; fleetKey: string | null; instances: EnrollmentEntry[] };
export type EnrollmentIntroduction = EnrollmentRoster & { enrollmentId: string; claimSecret: string };
export function validName(value: string): boolean { return /^[a-z][a-z0-9-]{0,39}$/u.test(value); }
export function validateController(controller: ControllerDescriptor) {
  if (!controller.name.trim() || controller.name.length > 100 || Object.entries(controller.metadata ?? {}).length > 16
    || Object.entries(controller.metadata ?? {}).some(([key, value]) => !validName(key) || typeof value !== 'string' || value.length > 256)) return failure('invalid', 'Invalid controller descriptor');
  return success(controller);
}
export function validateRoster(roster: EnrollmentRoster) {
  if (!/^@[^:\s]+:[^\s]+$/u.test(roster.ownerMatrixId) || roster.fleetKey !== null && !validName(roster.fleetKey)
    || roster.instances.length < 1 || roster.instances.length > 100 || roster.fleetKey === null && roster.instances.length !== 1
    || roster.instances.some(item => !validName(item.instanceKey) || !validName(item.name))
    || new Set(roster.instances.map(item => item.instanceKey)).size !== roster.instances.length
    || new Set(roster.instances.map(item => item.name)).size !== roster.instances.length) return failure('invalid', 'Supply one owner and a unique roster of valid lowercase names and instance keys');
  if (roster.fleetKey === null ? roster.controller !== undefined || roster.controllerCredential !== undefined : !roster.controller) return failure('invalid', 'Fleet enrollment requires exactly one controller descriptor');
  if (roster.controller) { const controller = validateController(roster.controller); if (!controller.ok) return controller; }
  return success(roster);
}
