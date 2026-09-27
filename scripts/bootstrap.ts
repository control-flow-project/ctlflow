import { join } from 'node:path';
import { existsSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { INSTANCES, type InstanceConfig } from './instance.ts';
import { API, Matrix, privateDir, readJson, writeJson, register, segment, powerLevels,
  type Settings, type Account } from '../skills/conduit-chat/scripts/lib.ts';

export function configure(config: InstanceConfig): { privatePath: string; settings: Settings } {
  if (existsSync(INSTANCES)) for (const entry of readdirSync(INSTANCES, { withFileTypes: true })) {
    const path = join(INSTANCES, entry.name, 'instance.json');
    if (!entry.isDirectory() || !existsSync(path)) continue;
    const other = readJson<InstanceConfig>(path);
    if (other.id === config.id) {
      if (other.server_name !== config.server_name || other.observer.username !== config.observer.username) {
        throw new Error('Keep the server identity and observer username of an initialized instance; create a new instance to change them');
      }
    } else {
      if (other.server_name === config.server_name) throw new Error('Another instance already uses this server_name');
      if ([other.matrix_port, other.web_port].some(port => port === config.matrix_port || port === config.web_port)) throw new Error('Another instance reserves one of these ports');
    }
  }
  const folder = privateDir(join(INSTANCES, config.id));
  const privatePath = privateDir(join(folder, 'private'));
  privateDir(join(folder, 'data'));
  const settingsPath = join(privatePath, 'settings.json');
  const previous = existsSync(settingsPath) ? readJson<Settings>(settingsPath) : undefined;
  const settings: Settings = {
    instance: config.id, label: config.label, homeserver: `http://127.0.0.1:${config.matrix_port}`,
    room_service: `http://127.0.0.1:${config.web_port}`, server_name: config.server_name,
    observer: `@${config.observer.username}:${config.server_name}`, observer_label: config.observer.display_name,
    registration_token: previous?.registration_token ?? randomBytes(40).toString('base64url'),
    max_upload_bytes: config.max_upload_bytes, room_id: previous?.room_id ?? '', room_alias: previous?.room_alias ?? '',
  };
  writeJson(settingsPath, settings);
  writeJson(join(folder, 'instance.json'), config);
  const fields = {
    server_name: config.server_name, database_backend: 'rocksdb', database_path: `/runtime/instances/${config.id}/data`,
    address: '0.0.0.0', port: config.matrix_port, db_cache_capacity_mb: 128.0,
    max_request_size: config.max_upload_bytes, allow_federation: false, trusted_servers: [],
    allow_check_for_updates: false, allow_registration: true, registration_token: settings.registration_token,
    allow_room_creation: false, allow_encryption: false, allow_unstable_room_versions: false,
    default_room_version: '12', enable_lightning_bolt: false, log: 'warn',
  };
  const toml = '[global]\n' + Object.entries(fields).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')
    + '\n\n[global.well_known]\nclient = ' + JSON.stringify(settings.homeserver) + '\n';
  writeFileSync(join(privatePath, 'conduit.toml'), toml, { mode: 0o600 });
  chmodSync(join(privatePath, 'conduit.toml'), 0o600);
  return { privatePath, settings };
}

export async function accounts(config: InstanceConfig, privatePath: string, settings: Settings): Promise<void> {
  const accountPath = join(privatePath, 'admin.json');
  if (!existsSync(accountPath)) {
    const password = randomBytes(30).toString('base64url');
    const account = await register(settings, config.observer.username, password, settings.observer_label);
    account.password = password;
    writeJson(accountPath, account);
  }
  const admin = readJson<Account>(accountPath);
  const client = new Matrix(settings.homeserver, admin.access_token);
  await client.put(`${API}/profile/${segment(admin.user_id)}/displayname`, { displayname: settings.observer_label });
  const alias = `#${config.room.alias}:${config.server_name}`;
  if (!settings.room_id) {
    const result = await client.post<{ room_id: string }>(API + '/createRoom', {
      room_alias_name: config.room.alias, name: config.room.name, topic: config.room.topic,
      visibility: 'private', preset: 'public_chat', creation_content: { 'm.federate': false }, room_version: '12',
      power_level_content_override: powerLevels(),
      initial_state: [{ type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'shared' } }],
    });
    settings.room_id = result.room_id;
    settings.room_alias = alias;
    writeJson(join(privatePath, 'settings.json'), settings);
  }
  const base = `${API}/rooms/${segment(settings.room_id)}`;
  await client.put(base + '/state/m.room.name', { name: config.room.name });
  await client.put(base + '/state/m.room.topic', { topic: config.room.topic });
  const oldAlias = (await client.get<{ alias?: string }>(base + '/state/m.room.canonical_alias')).alias;
  if (oldAlias !== alias) {
    await client.put(`${API}/directory/room/${segment(alias)}`, { room_id: settings.room_id });
    await client.put(base + '/state/m.room.canonical_alias', { alias });
    if (oldAlias) await client.request('DELETE', `${API}/directory/room/${segment(oldAlias)}`);
  }
  settings.room_alias = alias;
  writeJson(join(privatePath, 'settings.json'), settings);
  const credentials = join(privatePath, 'web-login.txt');
  writeFileSync(credentials, `URL: ${settings.room_service}\nHomeserver: ${settings.homeserver}\nUsername: ${admin.user_id}\nPassword: ${admin.password}\n`, { mode: 0o600 });
  chmodSync(credentials, 0o600);
}
