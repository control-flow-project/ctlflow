import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import * as queries from "./data/queries.js";
import type { Store, Tables } from "./data/database.js";
import { authority } from "./native.js";
import type { Config } from "./config.js";
import { failure, success, type Result } from "../../../packages/contracts/src/result.js";
import { DEFAULT_AGENT_INSTRUCTIONS } from '../../../packages/contracts/src/management.js';

export type Context = {
  store: Store; config: Config; native: ReturnType<typeof authority>; now: () => number;
};
export type Human = { id: string; sessionHash: string };

export function agentRecord(ctx: Context, human: Human, id: string) {
  const current = actor(ctx, human);
  if (!current.ok) return current;
  const agent = queries.agent(ctx.store, id);
  return agent && (agent.owner === human.id || current.value.role === 'administrator')
    ? success(agent) : failure('missing', 'Agent not found');
}

export function actor(ctx: Context, human: Human, administrator = false): Result<Tables["members"]> {
  const session = queries.session(ctx.store, human.sessionHash);
  if (!session || session.member !== human.id || session.expires <= ctx.now()) return failure("unauthorized", "Management session expired or ended");
  const current = queries.member(ctx.store, human.id);
  if (!current || current.status !== "active" || queries.agentIdentity(ctx.store, human.id)) return failure("forbidden", "Active human authority required");
  if (administrator && current.role !== "administrator") return failure("forbidden", "Administrator required");
  return success(current);
}

export function secret(): string {
  return randomBytes(32).toString("base64url");
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function matches(value: string, stored: string): boolean {
  const actual = Buffer.from(hash(value), "hex");
  const expected = Buffer.from(stored, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function context(store: Store, config: Config, now = Date.now): Context {
  if (!queries.readPolicy(store)) queries.insertPolicy(store, {
    revision: 0, maxOwnerAgents: 10, maxAgents: 100, maxPending: 100,
    enrollmentSeconds: 600, reconcileSeconds: 300, agentInstructions: DEFAULT_AGENT_INSTRUCTIONS,
  });
  if (!queries.member(store, config.administrator)) queries.insertMember(store, {
    id: config.administrator, label: config.administrator.slice(1, config.administrator.indexOf(":")),
    role: "administrator", status: "active", revision: 0, created: now(),
    appliedStatus: null, appliedRevision: null, lastSuccess: null, error: null,
  });
  return { store, config, native: authority(config), now };
}

export function record(ctx: Context, actor: string, owner: string, target: string, action: string, detail: unknown = {}): void {
  queries.insertAudit(ctx.store, { actor, owner, target, action, detail: JSON.stringify(detail), created: ctx.now() });
}
