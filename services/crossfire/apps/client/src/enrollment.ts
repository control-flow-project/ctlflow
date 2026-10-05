import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { fields, text, userId } from '@ctlflow/crossfire-contracts/validation';
import { profileName, UUID, MAX_UPLOAD_BYTES, type PendingEnrollment } from '@ctlflow/crossfire-contracts/client';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { readProfile, type paths } from '@ctlflow/crossfire-adapter-filesystem/project';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import type { Manifest } from '@ctlflow/crossfire-contracts/release';
import { requireCurrentRelease } from '@ctlflow/crossfire-agent-core/release';
import { createCoordination } from '@ctlflow/crossfire-adapter-crossfire/coordination';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';

async function introduce(destination: ReturnType<typeof paths>, pending: PendingEnrollment): Promise<Result<PendingEnrollment>> {
  const client = createClient({ origin: pending.server });
  const introduced = await client.call(operations.introduceEnrollment, {}, { enrollmentId: pending.request, claimSecret: pending.secret,
    ownerMatrixId: pending.owner, fleetKey: null, instances: [{ instanceKey: pending.name, name: pending.name }] });
  if (!introduced.ok) return introduced;
  const { enrollment, instances } = introduced.value.data.enrollment;
  const item = instances[0];
  if (!item || item.outcome === 'failed') return failure('name_collision', 'Agent name is unavailable: ' + pending.name);
  const saved = { ...pending, code: enrollment.verificationCode, expires: enrollment.expiresAt };
  writeJson(destination.pending, saved);
  return success(saved);
}

export async function enroll(destination: ReturnType<typeof paths>, server: string, owner: string, name: string, installed: Manifest): Promise<Result<unknown>> {
  const origin = endpoint(server);
  if (!origin.ok) return origin;
  if (!userId(owner) || !profileName(name)) return failure('invalid', 'Supply the exact human owner ID and lowercase agent name');
  if (existsSync(destination.profile) || existsSync(destination.pending)) return failure('conflict', 'This local profile already exists; reconnect its identity');
  const current = await requireCurrentRelease(createCoordination({ origin: origin.value }), installed);
  if (!current.ok) return current;
  const pending: PendingEnrollment = { server: origin.value, owner, name, workspace: destination.workspace,
    request: randomUUID(), secret: randomBytes(32).toString('base64url'), code: '', expires: Date.now() + 86_400_000 };
  writeJson(destination.pending, pending);
  const introduced = await introduce(destination, pending);
  return introduced.ok ? success({ status: 'pending', owner, name, code: introduced.value.code, expires: introduced.value.expires,
    approvalUrl: origin.value + '/manage/enrollments/' + pending.request }) : introduced;
}

async function connected(destination: ReturnType<typeof paths>, installed: Manifest): Promise<Result<unknown>> {
  const profile = readProfile(destination.profile);
  if (realpathSync(profile.workspace) !== destination.workspace) return failure('invalid', 'Profile belongs to another project');
  const coordination = createCoordination({ origin: profile.settings.homeserver, token: profile.account.access_token });
  const current = await requireCurrentRelease(coordination, installed);
  if (!current.ok) return current;
  const response = await createClient({ origin: profile.settings.homeserver, token: profile.account.access_token }).call(operations.agent, { agentId: profile.id }, {});
  if (!response.ok) return response;
  const agent = response.value.data;
  if (agent.agentId !== profile.id || agent.owner.matrixUserId !== profile.settings.owner || agent.matrixUserId !== profile.account.user_id
    || agent.status !== 'active' || agent.owner.status !== 'active') return failure('forbidden', 'Agent or owner access is not active');
  return success({ status: 'connected', id: profile.id, owner: agent.owner.matrixUserId, user_id: agent.matrixUserId,
    release: installed.release, skillSha256: installed.artifacts['SKILL.md'].sha256, activity: agent.activity,
    managementUrl: profile.settings.homeserver + '/manage/agents/' + profile.id });
}

export async function connect(destination: ReturnType<typeof paths>, installed: Manifest): Promise<Result<unknown>> {
  if (existsSync(destination.profile)) return connected(destination, installed);
  if (!existsSync(destination.pending)) return failure('missing', 'Request enrollment for this project profile first');
  const parsed = fields(readJson<unknown>(destination.pending), ['server', 'owner', 'name', 'workspace', 'request', 'secret', 'code', 'expires']);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!text(input.server, 2048) || !userId(input.owner) || !profileName(input.name) || !text(input.workspace, 4096)
    || typeof input.request !== 'string' || !UUID.test(input.request) || !text(input.secret, 100)
    || typeof input.code !== 'string' || !/^([A-F0-9]{12})?$/u.test(input.code) || typeof input.expires !== 'number'
    || !Number.isSafeInteger(input.expires) || input.expires <= Date.now()
    || realpathSync(input.workspace) !== destination.workspace) return failure('invalid', 'Invalid, expired or different-project enrollment');
  const pending = input as PendingEnrollment;
  const current = await requireCurrentRelease(createCoordination({ origin: pending.server }), installed);
  if (!current.ok) return current;
  if (!pending.code) { const introduced = await introduce(destination, pending); if (!introduced.ok) return introduced; }
  const client = createClient({ origin: pending.server });
  const response = await client.call(operations.exchangeEnrollment, { enrollmentId: pending.request }, { claimSecret: pending.secret });
  if (!response.ok) return response;
  const result = response.value.data;
  if (result.status !== 'ready') return success({ status: result.status });
  const ready = result.instances[0];
  if (!ready || ready.instanceKey !== pending.name || !ready.agentId || !ready.account || result.ownerMatrixId !== pending.owner) {
    return failure('native', 'Enrollment identity does not match the approved roster');
  }
  const serverName = pending.owner.slice(pending.owner.indexOf(':') + 1);
  const health = await client.call(operations.health, {}, {});
  if (!health.ok) return health;
  writeJson(destination.profile, { workspace: destination.workspace, id: ready.agentId, account: {
    user_id: ready.account.matrixUserId, access_token: ready.account.accessToken, device_id: ready.account.deviceId },
    settings: { instance: health.value.data.instance, homeserver: pending.server, server_name: serverName,
      owner: pending.owner, max_upload_bytes: MAX_UPLOAD_BYTES } });
  return connected(destination, installed);
}
