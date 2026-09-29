import { existsSync, realpathSync } from "node:fs";
import { fields, text, userId, parseAgent } from "../../../packages/contracts/src/management.js";
import { account, profileName, UUID, MAX_UPLOAD_BYTES, type PendingEnrollment } from "../../../packages/contracts/src/client.js";
import { failure, success, type Result } from "../../../packages/kernel/src/result.js";
import { endpoint, nativeOk } from "../../../packages/matrix/src/http.js";
import { readProfile, type paths } from "../../../packages/agent-core/src/state.js";
import { readJson, writeJson } from "../../../packages/files/src/index.js";
import type { Manifest } from '../../../packages/contracts/src/release.js';
import { requireCurrentRelease } from '../../../packages/agent-core/src/release.js';

export async function enroll(destination: ReturnType<typeof paths>, server: string, owner: string, name: string, installed: Manifest): Promise<Result<unknown>> {
  const origin = endpoint(server);
  if (!origin.ok) return origin;
  if (!userId(owner) || !text(name, 80)) return failure("invalid", "Supply the exact human owner ID and proposed agent name");
  if (existsSync(destination.profile) || existsSync(destination.pending)) return failure("conflict", "This local profile already exists; do not overwrite its identity");
  const current = await requireCurrentRelease({ base: origin.value }, installed);
  if (!current.ok) return current;
  const response = await nativeOk({ base: origin.value }, "POST", "/_coord/enrollments", { owner, name });
  if (!response.ok) return response;
  const parsed = fields(response.value, ["id", "owner", "name", "code", "expires", "secret", "approvalUrl"]);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  if (typeof data.id !== "string" || !UUID.test(data.id) || data.owner !== owner || data.name !== name
    || !text(data.secret, 100) || !text(data.code, 12) || typeof data.expires !== "number"
    || !Number.isSafeInteger(data.expires) || data.expires <= Date.now()
    || data.approvalUrl !== origin.value + "/manage/enrollments/" + data.id) return failure("native", "Invalid enrollment response");
  const pending: PendingEnrollment = { server: origin.value, owner, name, workspace: destination.workspace,
    request: data.id, secret: data.secret, code: data.code, expires: data.expires };
  writeJson(destination.pending, pending);
  return success({ status: "pending", owner, name, code: pending.code, expires: pending.expires,
    approvalUrl: data.approvalUrl });
}

async function connected(destination: ReturnType<typeof paths>, installed: Manifest): Promise<Result<unknown>> {
  const profile = readProfile(destination.profile);
  if (realpathSync(profile.workspace) !== destination.workspace) return failure('invalid', 'Profile belongs to another project');
  const current = await requireCurrentRelease({ base: profile.settings.homeserver }, installed);
  if (!current.ok) return current;
  const response = await nativeOk({ base: profile.settings.homeserver, token: profile.account.access_token }, 'GET', '/_coord/agents/' + profile.id);
  if (!response.ok) return response;
  const parsed = parseAgent(response.value);
  if (!parsed.ok) return parsed;
  const agent = parsed.value;
  if (agent.id !== profile.id || agent.owner !== profile.settings.owner || agent.userId !== profile.account.user_id
    || agent.status !== 'active' || agent.ownerStatus !== 'active') return failure('forbidden', 'Agent or owner access is not active');
  return success({ status: 'connected', id: profile.id, owner: agent.owner, user_id: agent.userId,
    release: installed.release, skillSha256: installed.artifacts['SKILL.md'].sha256, activity: agent.activity,
    managementUrl: profile.settings.homeserver + '/manage/agents/' + profile.id });
}

export async function connect(destination: ReturnType<typeof paths>, installed: Manifest): Promise<Result<unknown>> {
  if (existsSync(destination.profile)) return connected(destination, installed);
  if (!existsSync(destination.pending)) return failure("missing", "Request enrollment for this project profile first");
  const parsed = fields(readJson<unknown>(destination.pending), ["server", "owner", "name", "workspace", "request", "secret", "code", "expires"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!text(input.server, 2048) || !userId(input.owner) || !text(input.name, 80) || !text(input.workspace, 4096)
    || typeof input.request !== "string" || !UUID.test(input.request) || !text(input.secret, 100)
    || !text(input.code, 12) || typeof input.expires !== "number" || !Number.isSafeInteger(input.expires)
    || input.expires <= Date.now() || realpathSync(input.workspace) !== destination.workspace) return failure("invalid", "Invalid, expired or different-project enrollment");
  const origin = endpoint(input.server);
  if (!origin.ok) return origin;
  const current = await requireCurrentRelease({ base: origin.value }, installed);
  if (!current.ok) return current;
  const response = await nativeOk({ base: origin.value }, "POST", "/_coord/enrollments/" + input.request + "/exchange", { secret: input.secret });
  if (!response.ok) return response;
  if (["pending", "rejected", "provisioning"].includes(String(response.value.status))) return success({ status: response.value.status });
  const ready = fields(response.value, ["status", "id", "owner", "account"]);
  if (!ready.ok) return ready;
  const identity = account(ready.value.account);
  if (!identity.ok) return identity;
  const serverName = input.owner.slice(input.owner.indexOf(":") + 1);
  if (ready.value.status !== "ready" || typeof ready.value.id !== "string" || !UUID.test(ready.value.id)
    || ready.value.owner !== input.owner || identity.value.user_id !== "@agent-" + ready.value.id + ":" + serverName) return failure("native", "Enrollment identity does not match the approved owner");
  const health = await nativeOk({ base: origin.value }, "GET", "/_coord/health");
  if (!health.ok) return health;
  if (!profileName(health.value.instance)) return failure("native", "Invalid instance identity");
  writeJson(destination.profile, { workspace: destination.workspace, id: ready.value.id, account: identity.value,
    settings: { instance: health.value.instance, homeserver: origin.value, server_name: serverName,
      owner: input.owner, max_upload_bytes: MAX_UPLOAD_BYTES } });
  return connected(destination, installed);
}
