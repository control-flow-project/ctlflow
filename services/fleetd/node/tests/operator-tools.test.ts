import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { saveBinding } from '@ctlflow/fleetd-storage/binding';
import { initializeAuthentication } from '@ctlflow/fleetd-storage/authentication';
import { success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { FleetView } from '@ctlflow/fleetd-contracts/api';
import { verifyFleet, preservation, verifyRetainedState, type Preservation } from '../tools/verify.js';
import { inspectNative } from '../tools/runtime/inspect.js';
import { inspectCodex } from '../tools/runtime/codex.js';
import type { NativeInspector, Attachment } from '../tools/runtime/types.js';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.code + ': ' + result.error.message); return result.value; }

test('fleet growth preserves every earlier account, exact history and provider file without requiring a reset', () => {
  const original = { instanceKey: 'helper', agentId: randomUUID(), contexts: [{ context: 'shared', sessionId: randomUUID() }] };
  const credential = { path: '/private/helper/.codex/auth.json', bytes: 20, sha256: 'a'.repeat(64) };
  const previous: Preservation = { identities: [original], files: [credential] };
  const added = { instanceKey: 'helper-max', agentId: randomUUID(), contexts: [{ context: 'shared', sessionId: randomUUID() }] };
  const current: Preservation = { identities: [added, original], files: [{ ...credential, path: '/private/helper-max/.codex/auth.json' }, credential] };
  assert.equal(verifyRetainedState(previous, previous).ok, true);
  assert.equal(verifyRetainedState(previous, current).ok, true);
  for (const invalid of [
    { ...current, identities: [added] },
    { ...current, identities: [added, { ...original, agentId: randomUUID() }] },
    { ...current, identities: [added, { ...original, contexts: [{ context: 'shared', sessionId: randomUUID() }] }] },
    { ...current, identities: [added, { ...original, contexts: [...original.contexts, { context: 'room', sessionId: randomUUID() }] }] },
    { ...current, files: [] },
    { ...current, files: [{ ...credential, bytes: 21 }] },
    { ...current, files: [{ ...credential, sha256: 'b'.repeat(64) }] },
    { ...current, identities: [...current.identities, original] },
    { ...current, identities: [...current.identities, { ...added, instanceKey: 'other' }] },
    { ...current, files: [...current.files, credential] },
  ]) assert.equal(verifyRetainedState(previous, invalid).ok, false);
  assert.equal(verifyRetainedState({ ...previous, identities: [original, original] }, current).ok, false);
  assert.equal(verifyRetainedState({ ...previous, files: [credential, credential] }, current).ok, false);
});

test('fleet verification uses only daemon GETs, exact native identities and the actual ancestor Git skill boundary', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleetd-operator-')), root = join(directory, 'controller'), fleetDirectory = join(directory, 'fleet');
  const previousConfiguration = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(directory, 'config');
  cleanup(scope, () => { if (previousConfiguration === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfiguration; });
  const authenticationKey = await initializeAuthentication();
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const definition = join(fleetDirectory, 'agents', 'analyst'), workspace = join(definition, 'workarea', 'helper');
  mkdirSync(workspace, { recursive: true, mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  execFileSync('git', ['init', '-q', directory]);
  writeFileSync(join(definition, 'agent.toml'), 'name="Analyst"\nruntime="codex"\n[runtime_options]\nmodel="gpt-5.2"\n', { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Operator fixture.', { mode: 0o600 });
  writeFileSync(join(fleetDirectory, 'runtime.toml'), 'fleet="research"\n[coordination]\nadapter="crossfire"\nserver="https://example.test"\nowner="@owner:test"\n[[instances]]\nkey="helper"\nname="helper"\ndefinition="analyst"\nworkarea="agents/analyst/workarea/helper"\n', { mode: 0o600 });
  const skill = join(directory, '.agents', 'skills', 'search', 'SKILL.md');
  mkdirSync(join(directory, '.agents', 'skills', 'search'), { recursive: true, mode: 0o700 }); writeFileSync(skill, 'fixture');
  const agentId = randomUUID(), fleetId = randomUUID(), sessionId = randomUUID();
  saveBinding(fleetDirectory, { server: 'https://example.test', owner: '@owner:test', fleetKey: 'research', fleetId, controllerCredential: 'private-controller', request: null,
    identities: [{ instanceKey: 'helper', name: 'helper', agentId, account: { user_id: '@helper:test', access_token: 'private-agent', device_id: 'fixture' } }] });
  const instance = { key: 'helper', name: 'helper', definition: 'analyst', workarea: 'agents/analyst/workarea/helper' };
  const view: FleetView = { fleetId, fleetKey: 'research', label: 'Research', directory: fleetDirectory, revision: 0, controller: { name: 'laptop' }, phase: 'running', error: null, resumeInstanceKeys: null,
    connection: { connected: true, deliveryEnabled: true, revision: 0, error: null },
    instances: [{ instance, phase: 'running', listenerActive: true, desiredActive: true, lastActivityAt: 1, historyAvailable: true,
      sessionId, error: null, startedAt: 1 }] };
  const attachment: Attachment = { runtime: 'codex', sessionId, workspace, connection: { endpoint: 'ws://127.0.0.1:12345', tokenFile: join(workspace, 'token') } };
  const requests: string[] = [];
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer ' + authenticationKey);
    requests.push(request.method! + ' ' + request.url);
    const path = new URL(request.url!, 'http://localhost').pathname;
    const data = path === '/api/fleets' ? [view] : path.endsWith('/contexts') ? [{ context: 'shared', runtime: 'codex', sessionId }] : attachment;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data, meta: { requestId: randomUUID(), ...(path === '/api/fleets' ? { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } : {}) } }));
  });
  const socket = join(root, 'fleetd.sock'); server.listen(socket); await once(server, 'listening'); chmodSync(socket, 0o600);
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const called: Attachment[] = [];
  const inspect: NativeInspector = async input => { called.push(input.attachment); return success({ sessionId, status: 'idle', authenticated: true, configuredModel: 'gpt-5.2', configuredReasoning: null, projectSkills: [{ name: 'search', path: skill }], turns: 0 }); };
  const input = { root, directory: fleetDirectory, running: true, fresh: true, noRooms: false, skills: ['search'] };
  const first = value(await verifyFleet(input, new AbortController().signal, inspect));
  assert(first && typeof first === 'object' && 'preservation' in first);
  const previous = value(preservation(first.preservation));
  value(await verifyFleet({ ...input, previous }, new AbortController().signal, inspect));
  assert(requests.every(request => request.startsWith('GET ')));
  assert(called.every(current => current.sessionId === sessionId && current.workspace === workspace));
  assert(!JSON.stringify(first).includes('private-agent') && !JSON.stringify(first).includes('private-controller'));
  assert.equal((await verifyFleet({ ...input, previous: { ...previous, identities: [{ instanceKey: 'helper', agentId: randomUUID(), contexts: [] }] } }, new AbortController().signal, inspect)).ok, false);
  assert.equal((await verifyFleet(input, new AbortController().signal, async input => success({ sessionId: input.attachment.sessionId, status: 'idle', authenticated: true, configuredModel: null, configuredReasoning: null, projectSkills: [], turns: 0 }))).ok, false);
  view.instances[0]!.listenerActive = false;
  assert.equal((await verifyFleet(input, new AbortController().signal, inspect)).ok, false);
  view.instances[0]!.listenerActive = true; attachment.workspace = directory;
  assert.equal((await verifyFleet(input, new AbortController().signal, inspect)).ok, false);
  assert.equal((await verifyFleet({ ...input, running: false }, new AbortController().signal, inspect)).ok, false);
  assert.equal((await inspectNative({ attachment: { ...attachment, runtime: 'unsupported' }, options: {}, fresh: false, requiredSkills: [] }, new AbortController().signal)).ok, false);
});

test('Codex operator inspection never opens turns, resumes histories or answers a native decision', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleetd-native-inspection-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const tokenFile = join(directory, 'token'); writeFileSync(tokenFile, 'private-fixture-token', { mode: 0o600 });
  const web = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(web, 'listening');
  cleanup(scope, async () => { for (const client of web.clients) client.terminate(); await new Promise<void>(resolve => web.close(() => resolve())); });
  const address = web.address(); assert(address && typeof address !== 'string');
  const sessionId = randomUUID(), methods: string[] = [], responses: unknown[] = [];
  let wrongWorkspace = false, busy = false, question = false, authenticated = true;
  web.on('connection', (socket: WebSocket, request) => {
    assert.equal(request.headers.authorization, 'Bearer private-fixture-token');
    socket.on('message', bytes => {
      const message = JSON.parse(String(bytes)) as { id?: number; method?: string; params?: Record<string, unknown> };
      if (!message.method) { responses.push(message); return; }
      methods.push(message.method);
      if (message.id === undefined) return;
      const result = message.method === 'initialize' ? {} : message.method === 'account/read' ? { account: authenticated ? { type: 'fixture' } : null }
        : message.method === 'thread/read' ? { thread: { id: sessionId, cwd: wrongWorkspace ? '/wrong' : directory, canAcceptDirectInput: true, status: { type: busy ? 'active' : 'idle' }, turns: [] } }
        : message.method === 'config/read' ? { config: {} }
        : message.method === 'model/list' ? { data: [{ model: 'gpt-5.2', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null }
        : { data: [{ cwd: directory, skills: [{ scope: 'repo', name: 'search', path: join(directory, '.agents', 'skills', 'search', 'SKILL.md') }], errors: [] }] };
      if (question && message.method === 'model/list') socket.send(JSON.stringify({ id: 'human-choice', method: 'item/tool/requestUserInput', params: { threadId: sessionId } }));
      socket.send(JSON.stringify({ id: message.id, result }));
    });
  });
  const attachment: Attachment = { runtime: 'codex', sessionId, workspace: directory, connection: { endpoint: 'ws://127.0.0.1:' + address.port, tokenFile } };
  const input = { attachment, options: { model: 'gpt-5.2', model_reasoning_effort: 'high' }, fresh: true, requiredSkills: ['search'] };
  const inspected = value(await inspectCodex(input, new AbortController().signal));
  assert.equal(inspected.turns, 0); assert.equal(inspected.configuredReasoning, 'high');
  assert.equal((await inspectCodex({ ...input, options: { model: 'unavailable' } }, new AbortController().signal)).ok, false);
  wrongWorkspace = true; assert.equal((await inspectCodex(input, new AbortController().signal)).ok, false); wrongWorkspace = false;
  busy = true; assert.equal((await inspectCodex(input, new AbortController().signal)).ok, false); busy = false;
  authenticated = false; assert.equal((await inspectCodex(input, new AbortController().signal)).ok, false); authenticated = true;
  question = true; assert.equal((await inspectCodex(input, new AbortController().signal)).ok, false);
  assert.deepEqual(responses, [], 'An unsolicited approval closes only the inspection connection without answering');
  assert(methods.every(method => ['initialize', 'initialized', 'account/read', 'thread/read', 'config/read', 'model/list', 'skills/list'].includes(method)));
});
