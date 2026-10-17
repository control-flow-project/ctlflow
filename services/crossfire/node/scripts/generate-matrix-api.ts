import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { fileURLToPath } from 'node:url';
import { kebab, type MatrixSchema, type Operation, type Parameter } from '@ctlflow/crossfire-adapter-matrix/schema';

type ObjectValue = Record<string, unknown>;
const disabled = new Set(['old_sync', 'room_initial_sync', 'peeking_events', 'third_party_lookup', 'third_party_membership',
  'cross_signing', 'key_backup', 'keys', 'voip', 'openid', 'sso_login_redirect', 'administrative_contact',
  'appservice_ping', 'appservice_room_directory', 'to_device']);
const operator = new Set(['admin', 'create_room', 'inviting', 'banning', 'kicking', 'room_state', 'room_upgrades']);
const account = new Set(['login', 'login_token', 'logout', 'refresh', 'registration', 'registration_tokens']);
const protectedIds = new Set(['setDisplayName', 'setRoomAlias', 'deleteRoomAlias', 'setRoomVisibilityOnDirectory', 'deleteDevice', 'deleteDevices', 'postPusher']);
const disabledIds = new Set(['getUrlPreviewAuthed']);

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid schema object');
  return value as ObjectValue;
}

export function generate(source: string): MatrixSchema {
  const root = resolve(source);
  const cache = new Map<string, ObjectValue>();
  function document(file: string): ObjectValue {
    if (!file.startsWith(root + '/')) throw new Error('Schema reference leaves source root');
    let found = cache.get(file);
    if (!found) { found = object(parse(readFileSync(file, 'utf8'))); cache.set(file, found); }
    return found;
  }
  function reference(input: unknown, file: string): ObjectValue {
    let value = object(input);
    const visited = new Set<string>();
    while (typeof value.$ref === 'string') {
      const [path = '', pointer = ''] = value.$ref.split('#');
      if (path.includes(':')) throw new Error('Remote schema reference is not permitted');
      file = path ? resolve(dirname(file), path) : file;
      const key = file + '#' + pointer;
      if (visited.has(key)) throw new Error('Cyclic parameter reference');
      visited.add(key);
      let selected: unknown = document(file);
      for (const part of pointer.split('/').slice(1)) selected = object(selected)[part.replaceAll('~1', '/').replaceAll('~0', '~')];
      value = object(selected);
    }
    return value;
  }
  const operations: Operation[] = [];
  for (const filename of readdirSync(root).filter(file => file.endsWith('.yaml')).sort()) {
    const file = join(root, filename), definition = document(file), family = filename.slice(0, -5);
    for (const [rawPath, rawItem] of Object.entries(object(definition.paths))) {
      const item = object(rawItem);
      for (const method of ['get', 'post', 'put', 'delete'] as const) {
        if (!item[method]) continue;
        const entry = object(item[method]);
        if (typeof entry.operationId !== 'string') throw new Error('Operation lacks identity');
        const servers = entry.servers ?? item.servers ?? definition.servers;
        if (!Array.isArray(servers) || !servers.length) throw new Error('Operation lacks native server path');
        const server = object(servers[0]);
        let base = String(server.url);
        for (const [name, value] of Object.entries(object(server.variables ?? {}))) base = base.replaceAll('{' + name + '}', String(object(value).default));
        const parameters: Parameter[] = [];
        for (const raw of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(entry.parameters) ? entry.parameters : [])]) {
          const parameter = reference(raw, file);
          if (parameter.deprecated === true) continue;
          if (parameter.in === 'header' && parameter.name === 'Content-Type') continue;
          if (!['path', 'query'].includes(String(parameter.in)) || typeof parameter.name !== 'string') throw new Error('Unexpected parameter: ' + entry.operationId + ' ' + JSON.stringify(parameter));
          const schema = reference(parameter.schema, file);
          const type = schema.type;
          if (!['string', 'integer', 'number', 'boolean', 'object', 'array'].includes(String(type))) throw new Error('Unsupported parameter type');
          if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.some(value =>
            typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))))) {
            throw new Error('Invalid native parameter enumeration');
          }
          parameters.push({ name: parameter.name, location: parameter.in as Parameter['location'], required: parameter.required === true,
            type: type as Parameter['type'], ...(Array.isArray(schema.enum) ? { values: schema.enum as NonNullable<Parameter['values']> } : {}),
            ...(typeof schema.minimum === 'number' ? { minimum: schema.minimum } : {}),
            ...(typeof schema.maximum === 'number' ? { maximum: schema.maximum } : {}) });
        }
        const names = parameters.map(parameter => kebab(parameter.name));
        if (new Set(names).size !== names.length) throw new Error('Parameter spelling collision: ' + entry.operationId);
        const request = entry.requestBody ? reference(entry.requestBody, file) : undefined;
        const content = request ? object(request.content) : undefined;
        const response = object(object(entry.responses)['200'] ?? object(entry.responses)['201'] ?? {});
        const responseContent = object(response.content ?? {});
        const id = entry.operationId;
        operations.push({ id, command: kebab(id), method: method.toUpperCase() as Operation['method'], path: new URL(base).pathname.replace(/\/$/, '') + rawPath.trim(),
          access: entry.deprecated === true ? 'deprecated' : disabled.has(family) || disabledIds.has(id) ? 'unsupported' : operator.has(family) || protectedIds.has(id)
            ? 'operator' : account.has(family) ? 'account' : 'agent', parameters,
          body: content && !('application/json' in content) ? 'binary' : request ? request.required === true ? 'required' : 'optional' : 'none',
          response: Object.keys(responseContent).some(type => type !== 'application/json') ? 'binary' : 'json' });
      }
    }
  }
  operations.sort((left, right) => left.command.localeCompare(right.command));
  if (new Set(operations.map(operation => operation.command)).size !== operations.length) throw new Error('Command spelling collision');
  const hash = createHash('sha256');
  for (const [file] of [...cache].sort(([left], [right]) => left.localeCompare(right))) hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  return { version: 'v1.12', sourceSha256: hash.digest('hex'), operations };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, source: { type: 'string' }, check: { type: 'boolean' } } });
  if (!values.root) throw new Error('--root must name the exact ctlflow monorepo root');
  if (!values.source) throw new Error('--source must name the official v1.12 data/api/client-server directory');
  const text = JSON.stringify(generate(values.source), null, 2) + '\n';
  if (JSON.parse(text).sourceSha256 !== '037337015f765c9d96a0561888ea15c870d34ea327dac94bab6884e33a0b30cd') {
    throw new Error('Source files differ from the audited official v1.12 schema snapshot');
  }
  const output = join(resolve(values.root), 'services/crossfire/node/packages/adapter-matrix/src/operations.json');
  if (values.check) {
    if (readFileSync(output, 'utf8') !== text) throw new Error('Generated Matrix operation catalog is stale');
  } else writeFileSync(output, text);
  console.log('Verified Matrix operation spelling, parameters and native paths.');
}
