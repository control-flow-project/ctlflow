import { fields, text, userId } from "./validation.js";
import { failure, success, type Result } from "@ctlflow/crossfire-kernel/result";
import type { JsonObject } from "./json.js";

export type Account = { user_id: string; access_token: string; device_id: string };
export type Settings = { instance: string; homeserver: string; server_name: string; owner: string; max_upload_bytes: number };
export type Profile = { settings: Settings; workspace: string; id: string; account: Account };
export type Event = { event_id: string; sender: string; type: string; state_key?: string;
  content: JsonObject; origin_server_ts?: number; unsigned?: JsonObject };
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

export function profileName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/u.test(value);
}

export function account(value: unknown): Result<Account> {
  const input = fields(value, ["user_id", "access_token", "device_id"]);
  if (!input.ok) return input;
  return userId(input.value.user_id) && text(input.value.access_token, 8192) && text(input.value.device_id, 255)
    ? success(input.value as Account) : failure("invalid", "Invalid agent account");
}

export function settings(value: unknown): Result<Settings> {
  const input = fields(value, ["instance", "homeserver", "server_name", "owner", "max_upload_bytes"]);
  if (!input.ok) return input;
  const data = input.value;
  if (!profileName(data.instance) || !text(data.homeserver, 2048) || !text(data.server_name, 255) || !userId(data.owner)
    || data.owner.slice(data.owner.indexOf(":") + 1) !== data.server_name
    || !Number.isSafeInteger(data.max_upload_bytes) || Number(data.max_upload_bytes) < 1
    || Number(data.max_upload_bytes) > MAX_UPLOAD_BYTES) return failure("invalid", "Invalid project instance settings");
  return success(data as Settings);
}

export function profile(value: unknown): Result<Profile> {
  const input = fields(value, ["settings", "workspace", "id", "account"]);
  if (!input.ok) return input;
  const configuration = settings(input.value.settings);
  const identity = account(input.value.account);
  if (!configuration.ok) return configuration;
  if (!identity.ok) return identity;
  if (!text(input.value.workspace, 4096) || typeof input.value.id !== "string" || !UUID.test(input.value.id)
    || identity.value.user_id !== "@agent-" + input.value.id + ":" + configuration.value.server_name) {
    return failure("invalid", "Invalid project agent identity");
  }
  return success({ settings: configuration.value, workspace: input.value.workspace, id: input.value.id, account: identity.value });
}
