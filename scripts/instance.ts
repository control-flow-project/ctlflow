import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJson, name, type RoomDefinition } from '../skills/conduit-chat/scripts/lib.ts';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DATA = resolve(process.env.CROSSFIRE_DATA_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'crossfire'));
export const INSTANCES = join(DATA, 'instances');
export const CONFIGURATIONS = resolve(process.env.CROSSFIRE_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'crossfire/instances'));
export type InstanceConfig = {
  id: string; label: string; server_name: string; matrix_port: number; web_port: number;
  observer: { username: string; display_name: string };
  default_room: string; rooms: RoomDefinition[]; max_upload_bytes: number;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a configuration object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join(',') !== expected.sort().join(',')) throw new Error('Required fields: ' + expected.join(', '));
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 1000) throw new Error('Display text must contain 1..1000 characters');
}

export function validate(value: unknown): InstanceConfig {
  let config = object(value);
  if ('room' in config) {
    keys(config, ['id', 'label', 'server_name', 'matrix_port', 'web_port', 'observer', 'room', 'max_upload_bytes']);
    const legacy = object(config.room);
    keys(legacy, ['alias', 'name', 'topic']);
    const { room: _legacy, ...rest } = config;
    config = { ...rest, default_room: legacy.alias,
      rooms: [{ alias: legacy.alias, name: legacy.name, purpose: legacy.topic }] };
  }
  keys(config, ['id', 'label', 'server_name', 'matrix_port', 'web_port', 'observer', 'default_room', 'rooms', 'max_upload_bytes']);
  text(config.id); name(config.id);
  text(config.server_name);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(config.server_name)) throw new Error('server_name must be a lowercase DNS-style identity');
  for (const port of [config.matrix_port, config.web_port]) {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Ports must be integers from 1024 to 65535');
  }
  if (config.matrix_port === config.web_port) throw new Error('Matrix and web ports must differ');
  const observer = object(config.observer); keys(observer, ['username', 'display_name']);
  text(observer.username); text(observer.display_name);
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(observer.username)) throw new Error('Invalid observer username');
  if (!Array.isArray(config.rooms) || config.rooms.length === 0) throw new Error('rooms must be a nonempty array');
  const aliases = new Set<string>();
  for (const entry of config.rooms) {
    const room = object(entry); keys(room, ['alias', 'name', 'purpose']);
    text(room.alias); name(room.alias); text(room.name); text(room.purpose);
    if (aliases.has(room.alias)) throw new Error('Duplicate room alias: ' + room.alias);
    aliases.add(room.alias);
  }
  text(config.default_room);
  if (!aliases.has(config.default_room)) throw new Error('default_room must name a configured room alias');
  text(config.label);
  if (typeof config.max_upload_bytes !== 'number' || !Number.isInteger(config.max_upload_bytes)
      || config.max_upload_bytes < 1 || config.max_upload_bytes > 1073741824) throw new Error('Upload limit must be 1 byte to 1 GiB');
  return config as unknown as InstanceConfig;
}

export function load(instance: string): InstanceConfig {
  return validate(readJson<unknown>(join(INSTANCES, name(instance), 'instance.json')));
}

export function elementConfig(config: InstanceConfig) {
  return {
    default_server_config: { 'm.homeserver': { base_url: `http://127.0.0.1:${config.matrix_port}`, server_name: config.server_name } },
    disable_custom_urls: true, disable_guests: true, disable_3pid_login: true, force_verification: false,
    brand: config.label, integrations_ui_url: '', integrations_rest_url: '', integrations_widgets_urls: [],
    default_federate: false, default_theme: 'light', room_directory: { servers: [config.server_name] },
    setting_defaults: { breadcrumbs: true, 'UIFeature.feedback': false, 'UIFeature.identityServer': false },
    element_call: { disable: true },
  };
}
