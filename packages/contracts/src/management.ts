import { failure, success, type Result } from "./result.js";
import { parseActivity, type ActivityView } from './activity.js';
import { wakePolicy, type WakePolicy } from './wake.js';

export type Role = "member" | "administrator";
export type Status = "active" | "suspended" | "revoked";
export type Grant = { room: string; muted: boolean } & ({ access: 'read' | 'reply' } | { access: 'custom'; level: number });
export const DEFAULT_AGENT_INSTRUCTIONS = '';
export const AGENT_INSTRUCTIONS_MAX_BYTES = 8192;
export type Policy = {
  revision: number; maxOwnerAgents: number; maxAgents: number; maxPending: number;
  enrollmentSeconds: number; reconcileSeconds: number; agentInstructions: string;
};
export type AgentView = {
  wakePolicy: WakePolicy;
  id: string; owner: string; userId: string; name: string; nativeName: string | null;
  status: Status; ownerStatus: Status; revision: number; grantRevision: number; grants: Grant[]; applied: Grant[];
  appliedGrantRevision: number | null;
  appliedRevision: number | null; lastSuccess: number | null; error: string | null; activity: ActivityView;
};
export type MemberView = {
  id: string; label: string; role: Role; status: Status; revision: number;
  appliedStatus: Status | null; appliedRevision: number | null; lastSuccess: number | null; error: string | null;
};

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function object(value: unknown): Result<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? success(value as Record<string, unknown>) : failure("invalid", "Expected an object");
}

export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Result<Record<string, unknown>> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  if (required.some(key => !(key in parsed.value)) || Object.keys(parsed.value).some(key => !required.includes(key) && !optional.includes(key))) {
    return failure("invalid", "Missing or unknown fields");
  }
  return parsed;
}

export function text(value: unknown, maximum = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function userId(value: unknown): value is string {
  return text(value, 255) && /^@[^:\s]+:[^\s]+$/u.test(value);
}

export function roomId(value: unknown): value is string {
  return text(value, 255) && /^!\S+$/u.test(value);
}

export function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function status(value: unknown): value is Status {
  return value === "active" || value === "suspended" || value === "revoked";
}

export function role(value: unknown): value is Role {
  return value === "member" || value === "administrator";
}

export function grants(value: unknown): Result<Grant[]> {
  if (!Array.isArray(value) || value.length > 100) return failure("invalid", "Expected at most 100 room grants");
  const result: Grant[] = [];
  const rooms = new Set<string>();
  for (const entry of value) {
    const parsed = fields(entry, ["room", "access", "muted"], ['level']);
    if (!parsed.ok) return parsed;
    const input = parsed.value;
    if (!roomId(input.room) || !['read', 'reply', 'custom'].includes(String(input.access)) || typeof input.muted !== "boolean"
      || (input.access === 'custom' ? typeof input.level !== 'number' || !Number.isSafeInteger(input.level) : input.level !== undefined)
      || rooms.has(input.room)) return failure("invalid", "Invalid or duplicate room grant");
    rooms.add(input.room);
    result.push(input.access === 'custom' ? { room: input.room, access: 'custom', level: input.level as number, muted: input.muted }
      : { room: input.room, access: input.access as 'read' | 'reply', muted: input.muted });
  }
  return success(result.sort((left, right) => compare(left.room, right.room)));
}

export function authorityChanged(previous: Grant[], next: Grant[]): boolean {
  return previous.length !== next.length || previous.some((grant, index) => !next[index] || grant.room !== next[index].room || !sameAccess(grant, next[index]));
}

export function sameAccess(left: Grant, right: Grant): boolean {
  return left.access === right.access && (left.access !== 'custom' || right.access === 'custom' && left.level === right.level);
}

export function parseAgent(value: unknown): Result<AgentView> {
  const input = fields(value, ["id", "owner", "userId", "name", "nativeName", "status", "ownerStatus", "revision",
    "grantRevision", "grants", "applied", "appliedGrantRevision", "appliedRevision", "lastSuccess", "error", "activity", "wakePolicy"]);
  if (!input.ok) return input;
  const data = input.value;
  const desired = grants(data.grants), applied = grants(data.applied);
  if (!desired.ok) return desired;
  if (!applied.ok) return applied;
  const activity = parseActivity(data.activity);
  if (!activity.ok) return activity;
  if (!wakePolicy(data.wakePolicy) || !text(data.id, 36) || !userId(data.owner) || !userId(data.userId) || !text(data.name)
    || data.nativeName !== null && !text(data.nativeName, 255) || !status(data.status) || !status(data.ownerStatus)
    || !revision(data.revision) || !revision(data.grantRevision)
    || data.appliedGrantRevision !== null && !revision(data.appliedGrantRevision)
    || data.appliedRevision !== null && !revision(data.appliedRevision)
    || data.lastSuccess !== null && !revision(data.lastSuccess)
    || data.error !== null && !text(data.error, 4096)) return failure("invalid", "Invalid managed agent response");
  return success({ ...data, grants: desired.value, applied: applied.value } as AgentView);
}

export const POLICY_LIMITS = {
  maxOwnerAgents: { min: 1, max: 100 }, maxAgents: { min: 1, max: 1000 }, maxPending: { min: 1, max: 1000 },
  enrollmentSeconds: { min: 60, max: 3600 }, reconcileSeconds: { min: 30, max: 3600 },
} as const;
export const INVITATION_LIFETIME = { min: 60, max: 604800, default: 86400 } as const;
export const HUMAN_SIGNUP = { usernameMax: 100, usernamePattern: '[a-z0-9][a-z0-9._=\\-]*', passwordMin: 12, passwordMax: 1024, labelMax: 80 } as const;

export function policy(value: unknown): Result<Policy> {
  const parsed = fields(value, ["revision", "maxOwnerAgents", "maxAgents", "maxPending", "enrollmentSeconds", "reconcileSeconds", "agentInstructions"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!revision(input.revision)) return failure("invalid", "Invalid policy revision");
  if (typeof input.agentInstructions !== 'string' || new TextEncoder().encode(input.agentInstructions).length > AGENT_INSTRUCTIONS_MAX_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.agentInstructions)) {
    return failure('invalid', 'Agent instructions must be plain text up to ' + AGENT_INSTRUCTIONS_MAX_BYTES + ' UTF-8 bytes');
  }
  for (const [key, { min: minimum, max: maximum }] of Object.entries(POLICY_LIMITS)) {
    const number = input[key];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
      return failure("invalid", "Invalid finite policy limit: " + key);
    }
  }
  if (Number(input.maxOwnerAgents) > Number(input.maxAgents)) return failure("invalid", "Owner limit exceeds instance limit");
  return success(input as Policy);
}
