import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { API } from '@ctlflow/crossfire-contracts/matrix';
import { writeJson, readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import type { Account, Event, Settings } from '@ctlflow/crossfire-contracts/client';
import { connectCodex } from '@ctlflow/crossfire-adapter-codex/connection';
import type { RuntimeHooks } from '@ctlflow/crossfire-agent-core/runtime';
import { builtRelease } from './release.js';
import { createCoordination } from '@ctlflow/crossfire-adapter-crossfire/coordination';
import { serveArtifact } from '../../apps/server/src/artifacts.js';
import type { WakePolicy } from '@ctlflow/crossfire-contracts/wake';
import type { PrincipalIdentity } from '@ctlflow/crossfire-contracts/schema/response';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import { createListenerControl } from '@ctlflow/crossfire-agent-core/listener-control';
import type { ControllerBinding } from '@ctlflow/crossfire-agent-core/listener-control-port';
import { createListenerHost } from '@ctlflow/crossfire-adapter-crossfire/listener-host';

export const THREAD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
export const OBSERVER = '@human:test.localhost';
export const AGENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef';
export const SELF = '@agent-' + AGENT_ID + ':test.localhost';
export const ROOM = '!coordination:test.localhost';
export const OWNER_DM = '!owner-dm:test.localhost';
export const CONTROLLER: ControllerBinding = { fleetId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
  connectionId: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', credential: 'fixture-only-controller-capability' };

export function temporary(_context: TestContext): string {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/crossfire-listener-'));
  return directory;
}

export async function fakeCodex(t: TestContext, config: Record<string, unknown> = {}) {
  const directory = temporary(t);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (info: { req: import('node:http').IncomingMessage }) => info.req.headers.authorization === 'Bearer fixture-only' });
  await once(server, 'listening');
  cleanup(t, () => new Promise<void>(resolve => {
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
    if (!request.method) return;
    const mode = configuration.mode;
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    if (request.method === 'initialized') return;
    if (request.method === 'initialize') {
      if (mode === 'invalid-json') { socket.send('invalid json'); return; }
      if (mode === 'malformed-error') { send({ id: request.id, error: null }); return; }
      if (mode === 'unexpected-id') { send({ id: -1, result: {} }); return; }
      if (mode === 'oversized') { socket.send('x'.repeat(8 * 1024 * 1024 + 1)); return; }
      send({ id: request.id, result: { userAgent: 'protocol fixture' } });
    } else if (['thread/start', 'thread/resume', 'thread/read'].includes(request.method)) {
      send({ id: request.id, result: { approvalPolicy: configuration.approvalPolicy ?? 'never', thread: { id: configuration.thread, cwd: configuration.workspace,
        status: { type: configuration.status ?? 'idle' },
        canAcceptDirectInput: 'directInput' in configuration ? configuration.directInput : true } } });
    } else if (request.method === 'thread/turns/list') {
      if (configuration.unmaterialized && turns.size === 0) {
        send({ id: request.id, error: { code: -32600, message: `thread ${THREAD} is not materialized yet; thread/turns/list is unavailable before first user message` } });
        return;
      }
      const all = [...turns].reverse().map(id => ({ id, status: [...history].reverse().find(entry => entry.type === 'turnCompleted' && entry.turnId === id)?.status ?? 'inProgress' }));
      const start = Number(request.params.cursor ?? 0), end = start + Number(request.params.limit);
      send({ id: request.id, result: { data: all.slice(start, end), nextCursor: end < all.length ? String(end) : null } });
    } else if (request.method === 'turn/interrupt') {
      if (configuration.rejectInterrupt) { send({ id: request.id, error: { code: -32602, message: 'interruption refused' } }); return; }
      send({ id: request.id, result: {} });
      if (!configuration.delayInterrupt) notify('turn/completed', { threadId: THREAD, turn: { id: request.params.turnId, status: 'interrupted', error: null } });
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
  const update = (changes: Record<string, unknown>) => { Object.assign(configuration, changes); };
  update({});
  return {
    directory, update, notify, publish: () => { for (const publish of publications.splice(0)) publish(); },
    disconnect: () => { for (const client of server.clients) client.terminate(); },
    options: { session: THREAD, workspace: directory, endpoint: `ws://127.0.0.1:${address.port}`, token: 'fixture-only', receiptFile: join(directory, 'receipt.json'), timeoutMs: 2000, pollMs: 100,
      hooks: { requestDecision: async () => { throw new Error('Unexpected native permission in delivery fixture'); } } },
    runtime: (signal: AbortSignal, pollMs: number, hooks?: RuntimeHooks, timeoutMs = 2000) => connectCodex({ session: THREAD, workspace: directory, endpoint: `ws://127.0.0.1:${address.port}`, token: 'fixture-only', receiptFile: join(directory, 'receipt.json'), timeoutMs, pollMs,
      hooks: hooks ?? { requestDecision: async () => { throw new Error('Unexpected native permission in delivery fixture'); } } }, signal),
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

export async function until(predicate: () => boolean | Promise<boolean>, message = 'Condition did not become true', timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await delay(10);
  }
}

export async function matrixFixture(t: TestContext, workspace: string, clock: Clock = nativeClock) {
  const host = await createListenerHost();
  cleanup(t, host.close);
  const controller = createListenerControl(async () => {}, () => CONTROLLER);
  controller.update({ active: true, input: null });
  cleanup(t, controller.close);
  const settings: Settings = { instance: 'test', server_name: 'test.localhost',
    homeserver: '', owner: OBSERVER, max_upload_bytes: 1024 };
  const account: Account = { user_id: SELF, access_token: 'fixture-only', device_id: 'fixture' };
  const identities = new Map<string, PrincipalIdentity>([
    [OBSERVER, { matrixUserId: OBSERVER, kind: 'human', ownerMatrixId: null, displayName: null, ownerDisplayName: null }],
    [SELF, { matrixUserId: SELF, kind: 'agent', ownerMatrixId: OBSERVER, displayName: null, ownerDisplayName: null }],
    ['@agent-holmes:test.localhost', { matrixUserId: '@agent-holmes:test.localhost', kind: 'agent', ownerMatrixId: OBSERVER, displayName: null, ownerDisplayName: null }],
  ]);
  const rooms = new Map<string, Event[]>([[ROOM, []], [OWNER_DM, []]]);
  const joined = new Set([ROOM, OWNER_DM]);
  const invites: Record<string, { invite_state: { events: Event[] } }> = {};
  const missingObserver = new Set<string>();
  const failures = new Map<string, number[]>();
  const gates = new Map<string, { wait: Promise<void>; entered: () => void }>();
  const requests: { path: string; query: URLSearchParams; method?: string; body?: unknown }[] = [];
  const eventPositions = new Map<string, number>();
  const extraMembers = new Set<string>();
  const muted = new Set<string>();
  const accessModes = new Map<string, 'read' | 'reply' | 'custom'>();
  const access = { ownerStatus: 'active', status: 'active' };
  const decisions = new Map<string, { id: string; questions: { id: string }[]; status: string; answers: { questionId: string; optionId: string | null; text: string | null }[] }>();
  const waking: { policy: WakePolicy; senders: string[] } = { policy: 'owner-agents', senders: [OBSERVER, '@agent-holmes:test.localhost'] };
  const release = builtRelease().release.manifest;
  const publication = { release: builtRelease().release };
  const reporting = { disconnect: false, current: release };
  const syncUpdates = { enabled: true, hung: false };
  const waiters = new Set<() => void>();
  let maximumWaiters = 0;
  let revision = 0;
  let pageOverride: unknown;
  function wake(): void { revision++; for (const waiter of [...waiters]) waiter(); }
  function send(response: ServerResponse, body: unknown, status = 200): void {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }
  function api(response: ServerResponse, data: unknown): void { send(response, { data, meta: { requestId: AGENT_ID } }); }
  const server = createServer(async (request, response) => {
    if (serveArtifact(publication.release, request.method ?? 'GET', request.url ?? '', response)) return;
    if (request.url !== '/api/releases/current' && request.headers.authorization !== 'Bearer ' + account.access_token) {
      send(response, { errcode: 'M_UNAUTHORIZED' }, 401); return;
    }
    const url = new URL(request.url!, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    requests.push({ path, query: url.searchParams, ...(request.method ? { method: request.method } : {}), body });
    const gate = gates.get(path);
    if (gate) { gates.delete(path); gate.entered(); await gate.wait; }
    const failure = failures.get(path)?.shift();
    if (failure) { send(response, { errcode: 'M_TEST', error: 'Fixture failure' }, failure); return; }
    if (path === '/api/releases/current') {
      api(response, reporting.current);
    } else if (path === '/api/principal-resolutions' && request.method === 'POST') {
      const input = body as { matrixUserIds: string[] };
      api(response, input.matrixUserIds.map(matrixUserId => identities.get(matrixUserId) ?? { matrixUserId, kind: 'unknown', ownerMatrixId: null, displayName: null, ownerDisplayName: null }));
    } else if (path === '/api/agents/' + AGENT_ID + '/runtime-decisions' && request.method === 'POST') {
      const decision = body as { id: string; questions: { id: string }[] };
      const stored = { ...decision, agentId: AGENT_ID, createdAt: Date.now(), status: 'pending', answers: [] };
      decisions.set(decision.id, stored);
      const { answers: _answers, ...view } = stored;
      send(response, { data: view, meta: { requestId: AGENT_ID } }, 201);
    } else if (path.startsWith('/api/agents/' + AGENT_ID + '/runtime-decisions/') && path.endsWith('/answer')) {
      const id = path.split('/').at(-2)!; const decision = decisions.get(id)!;
      api(response, { status: decision.status, answers: decision.answers });
    } else if (path.startsWith('/api/agents/' + AGENT_ID + '/runtime-decisions/') && path.endsWith('/receipt')) {
      const decision = decisions.get(path.split('/').at(-2)!)!;
      if (!decision) { send(response, { error: { code: 'missing', message: 'Decision not found' }, meta: { requestId: AGENT_ID } }, 404); return; }
      decision.status = (body as { status: string }).status; decision.answers = []; api(response, { accepted: true });
    } else if (path === '/api/agents/' + AGENT_ID + '/delivery-policy') {
      api(response, { agentId: AGENT_ID, ownerMatrixId: OBSERVER, matrixUserId: SELF, ...access, maxMessageBytes: 65536,
        fleetIdleTimeoutSeconds: 1800, wakeMode: waking.policy,
        ownerConversation: joined.has(OWNER_DM) ? OWNER_DM : null,
        senderMatrixIds: access.status === 'active' && access.ownerStatus === 'active' ? waking.senders : [],
        roomGrants: [...joined].map(room => ({ roomId: room, accessMode: accessModes.get(room) ?? 'reply', powerLevel: null, muted: muted.has(room) })) });
    } else if (path === '/api/agents/' + AGENT_ID + '/owner-conversation' && request.method === 'POST') {
      joined.add(OWNER_DM); wake();
      api(response, { roomId: OWNER_DM });
    } else if (path === '/api/agents/' + AGENT_ID) {
      api(response, { agentId: AGENT_ID, matrixUserId: SELF, name: 'watson', displayName: 'Watson (Human)',
        owner: { memberId: AGENT_ID, matrixUserId: OBSERVER, displayName: 'Human', status: access.ownerStatus },
        status: access.status, revision: 0, createdAt: 1,
        application: { appliedRevision: 0, appliedStatus: 'active', nativeDisplayName: 'Watson (Human)',
          lastAttemptAt: 1, lastSuccessAt: 1, errorCode: null, errorMessage: null },
        activity: { status: 'offline', activeMs: 0, messagesDelivered: 0, lastSeenAt: null, activeRuns: [] }, nativeRuntime: null,
        deployment: { fleetId: CONTROLLER.fleetId, fleetKey: 'fixture', label: 'Fixture fleet', controllerName: 'Fixture controller', reportedAt: 1, instanceKey: 'watson' }, allowedActions: [] });
    } else if (path === '/api/agents/' + AGENT_ID + '/wake-deliveries' && request.method === 'GET') {
      api(response, { now: Date.now(), nextDueAt: null });
    } else if (path.startsWith('/api/agents/' + AGENT_ID + '/listener-runs/') && path.endsWith('/runtime') && request.method === 'PUT') {
      api(response, { accepted: true });
    } else if (path.startsWith('/api/agents/' + AGENT_ID + '/listener-runs/') && request.method === 'PUT') {
      if (JSON.stringify((body as { controller?: ControllerBinding }).controller) !== JSON.stringify(CONTROLLER)) {
        send(response, { error: { code: 'forbidden', message: 'Fixture listener requires its exact controller capability' }, meta: { requestId: AGENT_ID } }, 403); return;
      }
      api(response, { statisticsAccepted: true, disconnect: reporting.disconnect, currentRelease: reporting.current.release });
    } else if (path.startsWith('/api/agents/' + AGENT_ID + '/wake-notices/') && request.method === 'PUT') {
      send(response, { data: { outcome: 'not-applicable' }, meta: { requestId: AGENT_ID } }, 202);
    } else if (path === API + '/account/whoami') {
      send(response, { user_id: SELF });
    } else if (path === API + '/user/' + SELF + '/account_data/m.direct') {
      send(response, { [OBSERVER]: [OWNER_DM] });
    } else if (path === API + '/joined_rooms') {
      send(response, { joined_rooms: [...joined] });
    } else if (path === API + '/sync') {
      if (syncUpdates.hung) return;
      let cancelTimer: (() => void) | undefined;
      const complete = () => {
        cancelTimer?.(); waiters.delete(complete);
        const since = Number(url.searchParams.get('since')?.replace('sync-', '') ?? -1);
        const entries = [...joined].map(room => {
          const events = syncUpdates.enabled ? (rooms.get(room) ?? []).filter(event => (eventPositions.get(event.event_id) ?? 0) > since) : [];
          return [room, { timeline: { events: events.slice(-20), limited: events.length > 20 } }];
        });
        send(response, { next_batch: 'sync-' + revision, rooms: { invite: invites, join: Object.fromEntries(entries) } });
      };
      if (url.searchParams.get('since') === 'sync-' + revision && Number(url.searchParams.get('timeout')) > 0) {
        waiters.add(complete);
        maximumWaiters = Math.max(maximumWaiters, waiters.size);
        cancelTimer = clock.schedule(complete, Number(url.searchParams.get('timeout')));
        response.on('close', () => { cancelTimer?.(); waiters.delete(complete); });
      } else complete();
    } else if (path.startsWith(API + '/join/')) {
      const room = path.slice((API + '/join/').length);
      joined.add(room); delete invites[room]; send(response, { room_id: room });
    } else if (path.endsWith('/joined_members')) {
      const room = path.slice((API + '/rooms/').length, -'/joined_members'.length);
      send(response, { joined: { [SELF]: {}, ...Object.fromEntries([...(room === OWNER_DM ? [] : extraMembers)].map(member => [member, {}])), ...(!missingObserver.has(room) ? { [OBSERVER]: {} } : {}) } });
    } else if (path.endsWith('/state')) {
      const room = path.slice((API + '/rooms/').length, -'/state'.length);
      send(response, [
        { type: 'm.room.create', state_key: '', sender: OBSERVER, content: { room_version: '11' } },
        { type: 'm.room.power_levels', state_key: '', sender: OBSERVER, content: { users: { [OBSERVER]: 100, [SELF]: 0 } } },
        { type: 'm.room.join_rules', state_key: '', sender: OBSERVER, content: { join_rule: 'invite' } },
        { type: 'm.room.history_visibility', state_key: '', sender: OBSERVER, content: { history_visibility: 'shared' } },
        { type: 'm.room.member', state_key: OBSERVER, sender: OBSERVER, content: { membership: missingObserver.has(room) ? 'leave' : 'join' } },
        { type: 'm.room.member', state_key: SELF, sender: SELF, content: { membership: 'join' } },
      ]);
    } else if (path.endsWith('/messages')) {
      const room = path.slice((API + '/rooms/').length, -'/messages'.length);
      const events = rooms.get(room) ?? [];
      const position = (token: string | null, fallback: number) => token?.startsWith('sync-')
        ? events.filter(event => (eventPositions.get(event.event_id) ?? 0) <= Number(token.slice(5))).length : token === null ? fallback : Number(token);
      const backwards = url.searchParams.get('dir') === 'b';
      const start = position(url.searchParams.get('from'), backwards ? events.length : 0)
        - (backwards && url.searchParams.has('from') ? 1 : 0);
      const end = position(url.searchParams.get('to'), backwards ? 0 : events.length)
        - (url.searchParams.has('to') && !url.searchParams.get('to')!.startsWith('sync-') ? 1 : 0);
      const limit = Number(url.searchParams.get('limit'));
      const filter = JSON.parse(url.searchParams.get('filter') ?? '{}');
      const candidates = (backwards ? events.slice(end, start).reverse() : events.slice(start, end))
        .filter(event => (!filter.senders || filter.senders.includes(event.sender)) && (!filter.types || filter.types.includes(event.type)));
      const page = candidates.slice(0, limit);
      const next = page.length ? events.indexOf(page.at(-1)!) + 1 : start;
      send(response, pageOverride ?? { chunk: page, ...(page.length ? { end: String(next) } : {}) });
    } else if (path.endsWith('/read_markers')) {
      send(response, {});
    } else if (path.includes('/typing/')) {
      send(response, {});
    } else if (path.includes('/send/m.room.message/')) {
      const room = path.slice((API + '/rooms/').length, path.indexOf('/send/'));
      const event = { ...message('$sent-' + revision, SELF), content: body as Event['content'] };
      const events = rooms.get(room) ?? [];
      events.push(event); rooms.set(room, events);
      eventPositions.set(event.event_id, revision + 1); wake(); send(response, { event_id: event.event_id });
    } else if (path.endsWith('/leave')) {
      const room = path.slice((API + '/rooms/').length, -'/leave'.length);
      joined.delete(room); delete invites[room]; wake(); send(response, {});
    } else if (path.includes('/event/')) {
      const room = path.slice((API + '/rooms/').length, path.indexOf('/event/'));
      const event = rooms.get(room)?.find(event => event.event_id === path.slice(path.indexOf('/event/') + 7));
      send(response, event ?? {}, event ? 200 : 404);
    } else send(response, { error: 'Unexpected fixture request' }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup(t, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address === 'object');
  settings.homeserver = `http://127.0.0.1:${address.port}`;
  const cursorFile = join(workspace, '.crossfire/state/watson/cursors.json');
  writeJson(join(workspace, '.crossfire/profiles/watson.json'), { settings, account, id: AGENT_ID, workspace });
  return { binding: 'fixture', host, control: controller.connection, clock, coordination: createCoordination({ origin: settings.homeserver, token: account.access_token }), settings, account, id: AGENT_ID, release, workspace, cursorFile, requests, rooms, joined, invites, missingObserver, extraMembers, muted, accessModes, access, waking, syncUpdates, failures, identities, decisions,
    answerDecision(id: string, optionId = '0', text: string | null = null) {
      const decision = decisions.get(id)!; decision.status = 'answered';
      decision.answers = decision.questions.map(question => ({ questionId: question.id, optionId: text === null ? optionId : null, text }));
    },
    env: { ...process.env, CROSSFIRE_PROJECT: workspace }, reporting, publication,
    wake, waiting: () => waiters.size, maximumWaiting: () => maximumWaiters,
    hold: (path: string) => {
      let entered = false;
      let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      gates.set(path, { wait, entered: () => { entered = true; } });
      cleanup(t, release);
      return { entered: () => entered, release };
    },
    overridePage: (page: unknown) => { pageOverride = page; },
    subscribe: (room: string) => { joined.add(room); writeJson(cursorFile, { ...(existsSync(cursorFile) ? readJson<Record<string, string>>(cursorFile) : {}), [room]: '0' }); },
    add: (room: string, ...events: Event[]) => {
      for (const event of events) { eventPositions.set(event.event_id, ++revision); }
      rooms.set(room, [...rooms.get(room) ?? [], ...events]);
      if (syncUpdates.enabled) queueMicrotask(() => { for (const waiter of [...waiters]) waiter(); });
    },
  };
}
