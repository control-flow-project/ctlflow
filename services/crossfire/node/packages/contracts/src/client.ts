import { fields, text, userId } from './validation.js';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { backendParameters } from './schema/validation.js';
import { endpoint } from './origin.js';
import type { BackendAccount, BackendConfiguration } from '@ctlflow/crossfire-domain/port/messaging';
export type { MessageEvent } from '@ctlflow/crossfire-domain/port/messaging-client';

export type Account = BackendAccount;
export type Settings = { instance: string; server: string; backend: BackendConfiguration; owner: string; maxUploadBytes: number };
export type Profile = { settings: Settings; workspace: string; id: string; account: Account };
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

export function profileName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/u.test(value);
}

export function backendConfiguration(value: unknown): Result<BackendConfiguration> {
  const input = fields(value, ['type', 'parameters']);
  if (!input.ok) return input;
  const parameters = backendParameters(input.value.parameters);
  return profileName(input.value.type) && parameters.ok ? success({ type: input.value.type, parameters: parameters.value })
    : failure('invalid', 'Invalid messaging backend configuration');
}

export function account(value: unknown): Result<Account> {
  const input = fields(value, ['userId', 'accessToken', 'native']);
  if (!input.ok) return input;
  const native = backendParameters(input.value.native);
  return userId(input.value.userId) && text(input.value.accessToken, 8192) && native.ok
    ? success({ userId: input.value.userId, accessToken: input.value.accessToken, native: native.value }) : failure('invalid', 'Invalid agent account');
}

export function settings(value: unknown): Result<Settings> {
  const input = fields(value, ['instance', 'server', 'backend', 'owner', 'maxUploadBytes']);
  if (!input.ok) return input;
  const data = input.value, backend = backendConfiguration(data.backend);
  const server = typeof data.server === 'string' ? endpoint(data.server) : failure('invalid', 'Missing server origin');
  if (!profileName(data.instance) || !server.ok || !backend.ok || !userId(data.owner)
    || !Number.isSafeInteger(data.maxUploadBytes) || Number(data.maxUploadBytes) < 1 || Number(data.maxUploadBytes) > MAX_UPLOAD_BYTES)
    return failure('invalid', 'Invalid project instance settings');
  return success({ instance: data.instance, server: server.value, backend: backend.value, owner: data.owner, maxUploadBytes: Number(data.maxUploadBytes) });
}

export function profile(value: unknown): Result<Profile> {
  const input = fields(value, ["settings", "workspace", "id", "account"]);
  if (!input.ok) return input;
  const configuration = settings(input.value.settings);
  const identity = account(input.value.account);
  if (!configuration.ok) return configuration;
  if (!identity.ok) return identity;
  if (!text(input.value.workspace, 4096) || typeof input.value.id !== "string" || !UUID.test(input.value.id)) {
    return failure("invalid", "Invalid project agent identity");
  }
  return success({ settings: configuration.value, workspace: input.value.workspace, id: input.value.id, account: identity.value });
}
