import { request as httpRequest, type IncomingMessage } from 'node:http';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, renameSync, unlinkSync, chmodSync, fsyncSync, writeSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type RoomDefinition = { alias: string; name: string; purpose: string };
export type SharedRoom = RoomDefinition & { room_id: string };
export type RoomCatalog = { default_room: string; rooms: SharedRoom[] };
export type Settings = RoomCatalog & {
  instance: string; label: string; homeserver: string; room_service: string;
  server_name: string; observer: string; observer_label: string;
  registration_token: string; max_upload_bytes: number;
};
export type Account = { user_id: string; access_token: string; device_id: string; workspace?: string; password?: string; announcement_room_id?: string };
export type Event = { event_id: string; sender: string; type: string; state_key?: string; content: JsonObject; origin_server_ts?: number };
export type Members = Record<string, { display_name?: string; avatar_url?: string }>;
const pathsFile = new URL('.client-paths.json', import.meta.url);
const installedPaths = existsSync(pathsFile) ? JSON.parse(readFileSync(pathsFile, 'utf8')) as { config_dir?: string; state_dir?: string } : {};
export const CONFIG = resolve(process.env.CROSSFIRE_CLIENT_CONFIG_DIR ?? installedPaths.config_dir
  ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'conduit-chat'));
export const STATE = resolve(process.env.CROSSFIRE_CLIENT_STATE_DIR ?? installedPaths.state_dir
  ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'conduit-chat'));
export const API = '/_matrix/client/v3';
export const segment = encodeURIComponent;

export function name(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(value) || value === 'admin') {
    throw new Error('Names use 1..40 lowercase letters, digits, and hyphens; admin is reserved');
  }
  return value;
}

export function privateDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

export function readJson<T>(path: string): T {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed as T;
}

export function readSettings(path: string): Settings {
  const stored = readJson<Settings & { room_id?: string; room_alias?: string }>(path);
  if (Array.isArray(stored.rooms)) return stored;
  // Preserve the Matrix ID from the original single-room installation.
  const { room_id, room_alias, ...base } = stored;
  if (typeof room_id !== 'string' || typeof room_alias !== 'string') throw new Error('Invalid instance settings');
  const alias = room_alias.slice(1).split(':')[0] || 'coordination';
  return { ...base, default_room: alias, rooms: [{ alias, name: alias, purpose: 'Shared coordination.', room_id }] };
}

export function roomCatalog(value: unknown): RoomCatalog {
  if (!value || typeof value !== 'object') throw new Error('Invalid room catalog');
  const catalog = value as RoomCatalog;
  if (typeof catalog.default_room !== 'string' || !Array.isArray(catalog.rooms) || !catalog.rooms.length) throw new Error('Invalid room catalog');
  const aliases = new Set<string>(), ids = new Set<string>();
  for (const room of catalog.rooms) {
    if (!room || typeof room.alias !== 'string' || typeof room.name !== 'string' || !room.name
        || typeof room.purpose !== 'string' || !room.purpose || typeof room.room_id !== 'string' || !room.room_id.startsWith('!')) {
      throw new Error('Invalid configured room');
    }
    name(room.alias);
    if (aliases.has(room.alias) || ids.has(room.room_id)) throw new Error('Duplicate configured room');
    aliases.add(room.alias); ids.add(room.room_id);
  }
  if (!aliases.has(catalog.default_room)) throw new Error('Default room is not configured');
  return { default_room: catalog.default_room, rooms: catalog.rooms };
}

export function selectRoom(settings: Settings, selector = settings.default_room): string {
  const configured = settings.rooms.find(room => selector === room.alias || selector === `#${room.alias}:${settings.server_name}`);
  if (configured?.room_id) return configured.room_id;
  if (selector.startsWith('!')) return selector;
  throw new Error('Unknown room: ' + selector + '. Use rooms to list configured aliases and Matrix IDs.');
}

export function writeJson(path: string, value: unknown): void {
  privateDir(dirname(path));
  const temporary = join(dirname(path), '.pending-' + randomUUID());
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try { renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function emit(value: unknown): void {
  // Synchronous output precedes a cursor checkpoint. A crash may replay events;
  // the client never advances its cursor before writing the response.
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset);
}

export async function acquireProcessLock(path: string): Promise<() => Promise<void>> {
  privateDir(dirname(path));
  return lockfile.lock(path, {
    realpath: false, stale: 30_000, update: 5_000,
    retries: { retries: 45, factor: 1, minTimeout: 1000, maxTimeout: 1000 },
  });
}

export class MatrixError extends Error {
  status: number;
  body: JsonObject;
  constructor(status: number, body: JsonObject) {
    super(`HTTP ${status}: ${body.errcode ?? 'ERROR'}: ${body.error ?? ''}`);
    this.status = status;
    this.body = body;
  }
}

export class Matrix {
  base: string;
  token?: string;
  constructor(base: string, token?: string) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
        || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Only an http://127.0.0.1:<port> server is allowed');
    }
    this.base = base.replace(/\/$/, '');
    this.token = token;
  }

  async open(method: string, path: string, data?: Buffer, contentType = 'application/json'): Promise<IncomingMessage> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected a local API path');
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const headers: Record<string, string> = { 'Content-Type': contentType };
      if (this.token) headers.Authorization = 'Bearer ' + this.token;
      if (data) headers['Content-Length'] = String(data.length);
      // node:http connects directly; no HTTP proxy environment or redirects.
      const request = httpRequest(this.base + path, { method, headers }, resolve);
      request.setTimeout(45_000, () => request.destroy(new Error('Local server request timed out')));
      request.on('error', reject);
      request.end(data);
    });
    if ((response.statusCode ?? 500) >= 300) {
      const raw = await collect(response, 65536);
      let body: JsonObject = { error: 'Server returned a non-JSON error' };
      try { body = JSON.parse(raw.toString()) as JsonObject; } catch { /* keep bounded error */ }
      throw new MatrixError(response.statusCode ?? 500, body);
    }
    return response;
  }

  async request<T = JsonObject>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.open(method, path, body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
    const bytes = await collect(response, 32 * 1024 * 1024);
    const value: unknown = JSON.parse(bytes.toString());
    return value as T;
  }

  get<T = JsonObject>(path: string, query?: Record<string, string | number>): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) params.set(key, String(value));
    return this.request<T>('GET', path + (params.size ? '?' + params.toString() : ''));
  }
  post<T = JsonObject>(path: string, body: unknown): Promise<T> { return this.request<T>('POST', path, body); }
  put<T = JsonObject>(path: string, body: unknown): Promise<T> { return this.request<T>('PUT', path, body); }
}

export async function collect(stream: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of stream) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part as Uint8Array);
    size += chunk.length;
    if (size > limit) { stream.destroy(); throw new Error('Response exceeds the configured size limit'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function register(settings: Settings, username: string, password: string, displayName: string): Promise<Account> {
  const client = new Matrix(settings.homeserver);
  const body: JsonObject = { username, password, initial_device_display_name: displayName };
  try { return await client.post<Account>(API + '/register', body); }
  catch (error) {
    if (!(error instanceof MatrixError) || error.status !== 401 || typeof error.body.session !== 'string') throw error;
    body.auth = { type: 'm.login.registration_token', session: error.body.session, token: settings.registration_token };
    return client.post<Account>(API + '/register', body);
  }
}

export function powerLevels(): JsonObject {
  // In room version 12, the sole creator has implicit authority; creators must
  // not appear in the explicit users map. The observer creates every room.
  return { users: {}, users_default: 0, events_default: 0, state_default: 100,
    invite: 100, kick: 100, ban: 100, redact: 100, events: { 'm.room.encryption': 100 } };
}

export function localUser(value: string, settings: Settings): string {
  if (value === 'admin') return settings.observer;
  if (value.startsWith('@')) {
    if (value.slice(value.indexOf(':') + 1) !== settings.server_name) throw new Error('Recipient belongs to another instance');
    return value;
  }
  return `@agent-${name(value)}:${settings.server_name}`;
}

export async function ensureObserver(client: Matrix, room: string, settings: Settings): Promise<Members> {
  const result = await client.get<{ joined: Members }>(`${API}/rooms/${segment(room)}/joined_members`);
  if (!(settings.observer in result.joined)) throw new Error('Refusing this room: the observer must be a joined member');
  return result.joined;
}
