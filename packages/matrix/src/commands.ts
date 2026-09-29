import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import catalog from './operations.json' with { type: 'json' };
import { kebab, type MatrixSchema, type Operation, type Parameter } from './schema.js';
import { API, collect, segment, json, type Matrix } from './http.js';
import type { JsonObject } from '../../contracts/src/json.js';
import type { Account, Settings } from '../../contracts/src/client.js';
import { DEFAULT_EVENTS, MAX_EVENTS, MAX_JSON_BYTES } from '../../contracts/src/limits.js';
import { messageContent, MAX_MESSAGE_BYTES } from './message.js';
import { uploadStream, saveStream } from './files.js';

export const operations: readonly Operation[] = (catalog as MatrixSchema).operations;
export type Arguments = Readonly<Record<string, string | boolean | readonly string[] | undefined>>;

export function option(arguments_: Arguments, name: string): string | undefined {
  const value = arguments_[name];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1) return value[0]!;
  throw new Error(`--${name} requires exactly one value`);
}

export function selectOperation(command: string): Operation {
  const operation = operations.find(entry => entry.command === command);
  if (!operation) throw new Error('Unknown Matrix operation; use matrix --help');
  return operation;
}

export function operationOptions(operation: Operation): string[] {
  return [...operation.parameters.map(parameter => kebab(parameter.name)),
    ...(operation.body === 'binary' ? ['input-file', 'content-type'] : operation.body !== 'none' ? ['body', 'body-file'] : []),
    ...(operation.id === 'sendMessage' ? ['markdown', 'markdown-file'] : []),
    ...(operation.response === 'binary' || operation.method === 'GET' || ['search', 'queryPublicRooms'].includes(operation.id) ? ['output-file'] : []),
    ...(operation.response === 'json' && (operation.method === 'GET' || operation.id === 'search') ? ['view'] : [])];
}

export function jsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !json(value)) throw new Error(label + ' must be a JSON object');
  return value as JsonObject;
}

function parameterValue(parameter: Parameter, input: string): string {
  if (parameter.type === 'boolean' && !['true', 'false'].includes(input)) throw new Error(parameter.name + ' must be true or false');
  if (parameter.type === 'number' || parameter.type === 'integer') {
    if (!input.trim() || !Number.isFinite(Number(input)) || (parameter.type === 'integer' && !Number.isSafeInteger(Number(input)))) throw new Error(parameter.name + ' must be a finite ' + parameter.type);
    const number = Number(input);
    if ((parameter.minimum !== undefined && number < parameter.minimum) || (parameter.maximum !== undefined && number > parameter.maximum)) throw new Error(parameter.name + ' is outside the native range');
    if (parameter.name === 'limit' && (number < 1 || number > MAX_EVENTS)) throw new Error('limit must be 1..' + MAX_EVENTS);
    if (parameter.name === 'timeout' && (number < 0 || number > 30000)) throw new Error('timeout must be 0..30000');
  }
  if (parameter.type === 'object') jsonObject(JSON.parse(input), parameter.name);
  if (parameter.values && !parameter.values.some(value => String(value) === input)) throw new Error('Invalid ' + parameter.name);
  return input;
}

export function nativeRequest(operation: Operation, arguments_: Arguments) {
  let path = operation.path;
  const query = new URLSearchParams();
  const parameters: Record<string, string> = {};
  for (const parameter of operation.parameters) {
    const name = kebab(parameter.name);
    let values = arguments_[name];
    if (values === undefined && parameter.name === 'limit') values = String(DEFAULT_EVENTS);
    if (values === undefined && parameter.name === 'txnId') values = randomUUID();
    if (values === undefined) {
      if (parameter.required) throw new Error('--' + name + ' is required');
      continue;
    }
    const list = typeof values === 'string' ? [values] : Array.isArray(values) ? values : [];
    if (!list.length || (parameter.type !== 'array' && list.length !== 1)) throw new Error('Invalid --' + name);
    for (const value of list) {
      parameterValue(parameter, value);
      if (parameter.location === 'path') {
        if (['.', '..'].includes(value)) throw new Error('Invalid path segment');
        path = path.replace('{' + parameter.name + '}', segment(value));
        parameters[parameter.name] = value;
      } else query.append(parameter.name, value);
    }
  }
  return { path: path + (query.size ? '?' + query : ''), parameters };
}

export function requestBody(arguments_: Arguments): JsonObject | undefined {
  const inline = option(arguments_, 'body'), file = option(arguments_, 'body-file');
  const markdown = option(arguments_, 'markdown'), markdownFile = option(arguments_, 'markdown-file');
  if ([inline, file, markdown, markdownFile].filter(value => value !== undefined).length > 1) throw new Error('Supply one request body source');
  if (file || markdownFile) {
    if (statSync((file ?? markdownFile)!).size > MAX_JSON_BYTES) throw new Error('Request file exceeds the JSON limit');
  }
  if (markdown !== undefined || markdownFile) return { msgtype: 'm.text', body: markdownFile ? readFileSync(markdownFile, 'utf8') : markdown! };
  const text = file ? readFileSync(file, 'utf8') : inline;
  if (text === undefined) return undefined;
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new Error('Request exceeds the JSON limit');
  return jsonObject(JSON.parse(text), 'Request body');
}

function selfId(id: string | undefined, account: Account): void {
  if (id !== undefined && id !== account.user_id) throw new Error('This operation is restricted to the selected agent identity');
}

function boundedLimit(value: JsonObject): void {
  if (value.limit === undefined) value.limit = DEFAULT_EVENTS;
  if (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > MAX_EVENTS) throw new Error('Request limit must be 1..' + MAX_EVENTS);
}

export async function executeOperation(client: Matrix, settings: Settings, account: Account, operation: Operation, arguments_: Arguments) {
  if (operation.access !== 'agent') throw new Error(`${operation.command} is ${operation.access}; it is not an enabled agent operation`);
  const allowed = new Set([...operationOptions(operation), 'project', 'profile', 'max-output-bytes']);
  for (const key of Object.keys(arguments_)) if (!allowed.has(key)) throw new Error('Unsupported option --' + key + ' for ' + operation.command);
  const request = nativeRequest(operation, arguments_);
  const { parameters } = request;
  let body = requestBody(arguments_);
  const input = option(arguments_, 'input-file'), output = option(arguments_, 'output-file');
  if (operation.body === 'binary' && !input) throw new Error('--input-file is required');
  if (input && operation.body !== 'binary') throw new Error('--input-file requires a binary upload operation');
  if (operation.body === 'binary' && body) throw new Error('A binary upload cannot also contain JSON');
  if (operation.body === 'none' && body) throw new Error('This operation has no request body');
  if (operation.body === 'required' && !body) throw new Error('--body or --body-file is required');
  if (operation.response === 'binary' && !output) throw new Error('--output-file is required for binary media');
  if (parameters.serverName && parameters.serverName !== settings.server_name) throw new Error('Media must belong to this instance');
  if (option(arguments_, 'server') || option(arguments_, 'via')) throw new Error('Remote routing is disabled in this local instance');
  if (operation.method !== 'GET' || operation.id.startsWith('getAccountData') || operation.id === 'getRoomTags' || operation.id === 'getFilter') selfId(parameters.userId, account);
  if (operation.id === 'setAccountDataPerRoom' && parameters.type === 'm.fully_read') throw new Error('Use set-read-marker for Matrix read state');
  if (operation.id === 'updateDevice' && parameters.deviceId !== account.device_id) throw new Error('Only this agent device may be updated');
  const joining = operation.id === 'joinRoom' || operation.id === 'joinRoomById';
  if (operation.id === 'search') {
    const joined = await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms');
    if (!Array.isArray(joined.joined_rooms) || joined.joined_rooms.length > 1000 || joined.joined_rooms.some(room => typeof room !== 'string')) throw new Error('Invalid or excessive joined-room list');
    if (body && operation.id === 'search') {
      const categories = jsonObject(body.search_categories, 'search_categories');
      const events = jsonObject(categories.room_events, 'room_events');
      const filter = events.filter === undefined ? {} : jsonObject(events.filter, 'room_events.filter');
      boundedLimit(filter);
      if (filter.rooms !== undefined && (!Array.isArray(filter.rooms) || filter.rooms.some(room => typeof room !== 'string' || !joined.joined_rooms.includes(room)))) throw new Error('Search must use authorized joined rooms');
      filter.rooms = filter.rooms ?? joined.joined_rooms;
      events.filter = filter;
    }
  }
  if (body && ['queryPublicRooms', 'searchUserDirectory'].includes(operation.id)) boundedLimit(body);
  if (joining || operation.id === 'knockRoom') {
    const selected = parameters.roomIdOrAlias ?? parameters.roomId;
    if (!selected) throw new Error('A native Matrix room ID or alias is required');
    if (selected.startsWith('#') && !selected.endsWith(':' + settings.server_name)) throw new Error('Room alias belongs to another instance');
    if (!selected.startsWith('!') && !selected.startsWith('#')) throw new Error('A native Matrix room ID or alias is required');
  }
  if (output && operation.response !== 'binary' && operation.method !== 'GET' && !['search', 'queryPublicRooms'].includes(operation.id)) {
    throw new Error('--output-file is available for read operations and media downloads');
  }
  if ((option(arguments_, 'markdown') !== undefined || option(arguments_, 'markdown-file'))
      && (operation.id !== 'sendMessage' || parameters.eventType !== 'm.room.message')) throw new Error('Markdown requires send-message with event-type m.room.message');
  if (body && operation.id === 'sendMessage') {
    if (parameters.eventType === 'm.room.message') {
      body = messageContent(body);
    } else if (Buffer.byteLength(JSON.stringify(body)) > MAX_MESSAGE_BYTES) throw new Error('Encoded event content exceeds 50000 bytes');
  } else if (option(arguments_, 'markdown') !== undefined || option(arguments_, 'markdown-file')) throw new Error('Markdown requires send-message with event-type m.room.message');
  const wire = input ? uploadStream(input, settings.max_upload_bytes) : body ? Buffer.from(JSON.stringify(body)) : undefined;
  const response = await client.open(operation.method, request.path, wire, input ? option(arguments_, 'content-type') ?? 'application/octet-stream' : 'application/json');
  if (output) {
    return saveStream(response, output, operation.response === 'binary' ? settings.max_upload_bytes : MAX_JSON_BYTES);
  }
  const result: unknown = JSON.parse((await collect(response, MAX_JSON_BYTES)).toString('utf8'));
  if (!json(result)) throw new Error('Invalid bounded native JSON response');
  return result;
}
