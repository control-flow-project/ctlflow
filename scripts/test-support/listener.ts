import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { copyFileSync, chmodSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { API, writeJson, type Account, type Event, type Settings } from '../../skills/conduit-chat/scripts/lib.ts';
import type { CodexOptions } from '../../skills/conduit-chat/scripts/codex.ts';

export const THREAD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
export const OBSERVER = '@human:test.localhost';
export const SELF = '@agent-watson:test.localhost';
export const ROOM = '!coordination:test.localhost';

export function temporary(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-listener-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export async function fakeCodex(t: TestContext, config: Record<string, unknown> = {}) {
  const directory = temporary(t);
  const binary = join(directory, 'codex.mjs');
  copyFileSync(new URL('codex-proxy.mjs', import.meta.url), binary);
  chmodSync(binary, 0o700);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => {
    for (const client of server.clients) client.terminate();
    server.close(() => resolve());
  }));
  const address = server.address(); assert(address && typeof address === 'object');
  const configuration: Record<string, unknown> = { thread: THREAD, workspace: directory, port: address.port, ...config };
  const requests: { id?: number | string; method?: string; params?: Record<string, unknown> }[] = [];
  const history = structuredClone(config.initialHistory ?? []) as Record<string, unknown>[];
  const turns = new Set(history.filter(entry => entry.type === 'turnStarted').map(entry => String(entry.turnId)));
  const publications: (() => void)[] = [];
  let activeTurnId: string | undefined;
  const append = (entry: Record<string, unknown>) => history.push({ ...entry, position: Number(history.at(-1)?.position ?? 0) + 1 });
  const notify = (method: string, params: unknown) => {
    for (const client of server.clients) client.send(JSON.stringify({ method, params }));
    const event = params as Record<string, unknown>;
    if (event.threadId !== THREAD) return;
    if (method === 'item/completed') {
      append({ type: 'item', turnId: String(event.turnId ?? activeTurnId ?? configuration.turnId ?? 'existing-turn'), item: event.item });
    } else if (method === 'turn/completed') {
      const turn = event.turn as { id: string; status: string };
      append({ type: 'turnCompleted', turnId: turn.id, status: turn.status });
      if (activeTurnId === turn.id) activeTurnId = undefined;
      notify('thread/status/changed', { threadId: THREAD, status: { type: 'idle' } });
    }
  };
  server.on('connection', socket => socket.on('message', data => {
    const request = JSON.parse(data.toString());
    requests.push(request);
    const mode = configuration.mode;
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    if (request.method === 'initialized') return;
    if (request.method === 'initialize') {
      if (mode === 'invalid-json') { socket.send('invalid json'); return; }
      if (mode === 'malformed-error') { send({ id: request.id, error: null }); return; }
      if (mode === 'unexpected-id') { send({ id: -1, result: {} }); return; }
      if (mode === 'oversized') { socket.send('x'.repeat(8 * 1024 * 1024 + 1)); return; }
      send({ id: request.id, result: { userAgent: 'protocol fixture' } });
    } else if (request.method === 'thread/read') {
      send({ id: request.id, result: { thread: { id: configuration.thread, cwd: configuration.workspace,
        status: { type: configuration.status ?? 'idle' },
        canAcceptDirectInput: 'directInput' in configuration ? configuration.directInput : true } } });
    } else if (request.method === 'turn/start') {
      if (mode === 'disconnect') { socket.terminate(); return; }
      if (mode === 'timeout') return;
      if (mode === 'reject') { send({ id: request.id, error: { code: -32602, message: 'input rejected' } }); return; }
      if (mode === 'missing-turn') { send({ id: request.id, result: {} }); return; }
      if (mode === 'server-requests') {
        send({ method: 'turn/started', params: {} });
        send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
      }
      const turnId = configuration.turnId ?? activeTurnId ?? (turns.size ? 'turn-' + (turns.size + 1) : 'existing-turn');
      activeTurnId = String(turnId);
      const publish = () => {
        if (!turns.has(String(turnId))) {
          turns.add(String(turnId));
          append({ type: 'turnStarted', turnId });
        }
        if (mode !== 'accepted') {
          const item = inputReceipt(request.params.clientUserMessageId, request.params.input);
          append({ type: 'item', turnId: String(turnId), item });
        }
        if (configuration.completionFirst) {
          append({ type: 'turnCompleted', turnId, status: 'interrupted' });
          activeTurnId = undefined;
        }
      };
      if (configuration.receiptFirst || configuration.completionFirst) publish();
      send({ id: request.id, result: { turn: { id: turnId } } });
      if (configuration.deferHistory) publications.push(publish);
      else if (!configuration.receiptFirst && !configuration.completionFirst) publish();
    } else if (request.method === 'thread/timeline/list') {
      const failures = (request.params.limit === 1 ? configuration.boundaryUnavailable : configuration.historyUnavailable) as number[] | undefined;
      const code = failures?.shift();
      if (code) { send({ id: request.id, error: { code, message: 'history is not supported yet' } }); return; }
      if (configuration.historyError) { send({ id: request.id, error: { code: -32603, message: 'history unavailable' } }); return; }
      const pages = (request.params.limit === 1 ? configuration.boundaryPages : configuration.historyPages) as unknown[] | undefined;
      const end = request.params.cursor ? Number(request.params.cursor) : history.length;
      const start = Math.max(0, end - Number(request.params.limit));
      send({ id: request.id, result: pages?.shift() ?? { data: history.slice(start, end), nextCursor: start ? String(start) : null } });
    } else send({ id: request.id, error: { code: -32601, message: 'Forbidden method in fixture' } });
  }));
  const update = (changes: Record<string, unknown>) => {
    Object.assign(configuration, changes);
    writeJson(join(directory, 'codex.json'), configuration);
  };
  update({});
  return {
    directory, update, notify, publish: () => { for (const publish of publications.splice(0)) publish(); },
    disconnect: () => { for (const client of server.clients) client.terminate(); },
    options: { thread: THREAD, workspace: directory, binary, timeoutMs: 2000, pollMs: 100 } satisfies CodexOptions,
    requests: () => requests,
  };
}

export function inputReceipt(clientId: string, content: unknown = [{ type: 'text', text: 'input', text_elements: [] }]) {
  return { type: 'userMessage', id: 'item-' + clientId, clientId, content };
}

export function message(id: string, sender = '@agent-holmes:test.localhost', body = id): Event {
  return { event_id: id, type: 'm.room.message', sender, origin_server_ts: 1,
    content: { msgtype: 'm.text', body } };
}

export async function until(predicate: () => boolean, message = 'Condition did not become true'): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await delay(10);
  }
}

export async function matrixFixture(t: TestContext, workspace: string) {
  const settings: Settings = { instance: 'test', label: 'Test', server_name: 'test.localhost',
    homeserver: '', room_service: '', observer: OBSERVER, observer_label: 'Human',
    registration_token: 'enrollment-only', max_upload_bytes: 1024,
    default_room: 'coordination', rooms: [{ alias: 'coordination', room_id: ROOM, name: 'Coordination', purpose: 'Test' }] };
  const account: Account = { user_id: SELF, access_token: 'fixture-only', device_id: 'fixture', workspace };
  const rooms = new Map<string, Event[]>([[ROOM, []]]);
  const joined = new Set([ROOM]);
  const invites: Record<string, { invite_state: { events: Event[] } }> = {};
  const missingObserver = new Set<string>();
  const failures = new Map<string, number[]>();
  const requests: { path: string; query: URLSearchParams }[] = [];
  const waiters = new Set<() => void>();
  let revision = 0;
  let pageOverride: unknown;
  function wake(): void { revision++; for (const waiter of [...waiters]) waiter(); }
  function send(response: ServerResponse, body: unknown, status = 200): void {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer ' + account.access_token) {
      send(response, { errcode: 'M_UNAUTHORIZED' }, 401); return;
    }
    const url = new URL(request.url!, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);
    requests.push({ path, query: url.searchParams });
    const failure = failures.get(path)?.shift();
    if (failure) { send(response, { errcode: 'M_TEST', error: 'Fixture failure' }, failure); return; }
    if (path === '/_coord/rooms') {
      send(response, { default_room: settings.default_room, rooms: settings.rooms });
    } else if (path === API + '/joined_rooms') {
      send(response, { joined_rooms: [...joined] });
    } else if (path === API + '/sync') {
      let timer: NodeJS.Timeout | undefined;
      const complete = () => {
        clearTimeout(timer); waiters.delete(complete);
        send(response, { next_batch: String(revision), rooms: { invite: invites } });
      };
      if (url.searchParams.get('since') === String(revision) && Number(url.searchParams.get('timeout')) > 0) {
        waiters.add(complete);
        timer = setTimeout(complete, Number(url.searchParams.get('timeout')));
        response.on('close', () => { clearTimeout(timer); waiters.delete(complete); });
      } else complete();
    } else if (path.startsWith(API + '/join/')) {
      const room = path.slice((API + '/join/').length);
      joined.add(room); delete invites[room]; send(response, { room_id: room });
    } else if (path.endsWith('/joined_members')) {
      const room = path.slice((API + '/rooms/').length, -'/joined_members'.length);
      send(response, { joined: { [SELF]: {}, ...(!missingObserver.has(room) ? { [OBSERVER]: {} } : {}) } });
    } else if (path.endsWith('/messages')) {
      const room = path.slice((API + '/rooms/').length, -'/messages'.length);
      const start = Number(url.searchParams.get('from') ?? '0');
      const page = (rooms.get(room) ?? []).slice(start, start + Number(url.searchParams.get('limit')));
      send(response, pageOverride ?? { chunk: page, end: String(start + page.length) });
    } else send(response, { error: 'Unexpected fixture request' }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address === 'object');
  settings.homeserver = settings.room_service = `http://127.0.0.1:${address.port}`;
  const root = temporary(t);
  const cursorFile = join(root, 'state/test/watson/cursors.json');
  const config = join(root, 'config');
  writeJson(join(config, 'instances/test.json'), settings);
  writeJson(join(config, 'accounts/test/watson.json'), account);
  mkdirSync(join(root, 'state/test/watson'), { recursive: true });
  return { settings, account, cursorFile, requests, rooms, joined, invites, missingObserver, failures,
    env: { ...process.env, CROSSFIRE_CLIENT_CONFIG_DIR: config, CROSSFIRE_CLIENT_STATE_DIR: join(root, 'state') },
    wake, waiting: () => waiters.size,
    overridePage: (page: unknown) => { pageOverride = page; },
    add: (room: string, ...events: Event[]) => { rooms.set(room, [...rooms.get(room) ?? [], ...events]); wake(); },
  };
}
