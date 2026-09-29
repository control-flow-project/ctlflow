import { failure, success } from '../../../kernel/src/result.js';
export type EnrollmentIdentityProof = { agentId: string; accessToken: string };
export type EnrollmentEntry = { instanceKey: string; name: string; identity?: EnrollmentIdentityProof };
export type EnrollmentRoster = { ownerMatrixId: string; fleetKey: string | null; instances: EnrollmentEntry[] };
export type EnrollmentIntroduction = EnrollmentRoster & { enrollmentId: string; claimSecret: string };
export function validName(value: string): boolean { return /^[a-z][a-z0-9-]{0,39}$/u.test(value); }
export function validateRoster(roster: EnrollmentRoster) {
  if (!/^@[^:\s]+:[^\s]+$/u.test(roster.ownerMatrixId) || roster.fleetKey !== null && !validName(roster.fleetKey)
    || roster.instances.length < 1 || roster.instances.length > 100 || roster.fleetKey === null && roster.instances.length !== 1
    || roster.instances.some(item => !validName(item.instanceKey) || !validName(item.name))
    || new Set(roster.instances.map(item => item.instanceKey)).size !== roster.instances.length
    || new Set(roster.instances.map(item => item.name)).size !== roster.instances.length) return failure('invalid', 'Supply one owner and a unique roster of valid lowercase names and instance keys');
  return success(roster);
}
