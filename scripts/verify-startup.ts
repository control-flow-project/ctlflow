// Disposable Docker integration test: never reads or changes an existing instance.
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, type InstanceConfig } from './instance.ts';
import { bootstrapArguments } from './onboarding.ts';
import { API, Matrix, MatrixError, readJson, segment, type Account, type Settings, type JsonObject } from '../skills/conduit-chat/scripts/lib.ts';

const execute = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), 'crossfire-startup-'));
const data = join(directory, 'runtime'), skill = join(directory, 'agent skill');
const clientConfig = join(directory, 'client config'), state = join(directory, 'client state');
const env = { ...process.env, CROSSFIRE_DATA_DIR: data, CROSSFIRE_CONFIG_DIR: join(directory, 'config'),
  CROSSFIRE_SKILL_DIR: skill, CROSSFIRE_CLIENT_CONFIG_DIR: clientConfig, CROSSFIRE_CLIENT_STATE_DIR: state };
const processes = new Map<string, { child: ChildProcess; done: Promise<unknown>; output: string }>();
const privatePath = (id: string) => join(data, 'instances', id, 'private');
const settings = (id: string) => readJson<Settings>(join(privatePath(id), 'settings.json'));
const control = (id: string) => readJson<Account>(join(privatePath(id), 'control-session.json'));
const run = (...args: string[]) => execute(process.execPath, [join(ROOT, 'crossfire'), ...args], { env, maxBuffer: 4 * 1024 * 1024 });
let interrupted = false;
const cancel = () => { interrupted = true; for (const process of processes.values()) process.child.kill('SIGTERM'); };
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, cancel);

async function ports(): Promise<[number, number]> {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))));
    return servers.map(server => { const a = server.address(); assert(a && typeof a === 'object'); return a.port; }) as [number, number];
  } finally { await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
}
async function start(config: InstanceConfig): Promise<string> {
  const path = join(directory, config.id + '.json');
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, [join(ROOT, 'crossfire'), 'start', path], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const running = { child, done: new Promise(resolve => child.once('exit', resolve)), output: '' };
  processes.set(config.id, running);
  for (const stream of [child.stdout, child.stderr]) stream!.on('data', bytes => { running.output = (running.output + String(bytes)).slice(-100_000); });
  for (let n = 0; n < 300; n++) {
    if (interrupted) throw new Error('Verification interrupted');
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Test instance stopped before readiness');
    if (running.output.includes('CLIENT ONBOARDING')) {
      const response = await fetch(`http://127.0.0.1:${config.web_port}/_coord/health`);
      const health = await response.json() as { instance: string; status: string };
      assert.equal(health.instance, config.id); assert.equal(health.status, 'ready');
      return running.output;
    }
    await delay(100);
  }
  throw new Error('Test instance did not print onboarding instructions');
}
async function stop(id: string): Promise<void> {
  const running = processes.get(id);
  if (!running) return;
  await run('stop', id);
  await running.done;
  processes.delete(id);
}
async function chat(instance: string, agent: string, ...args: string[]): Promise<JsonObject> {
  const result = await execute(process.execPath, [join(skill, 'scripts/chat.mjs'), '--instance', instance, '--agent', agent, ...args], { env, cwd: directory });
  return JSON.parse(result.stdout) as JsonObject;
}
async function passwordAction(client: Matrix, path: string, body: JsonObject, user: string, password: string): Promise<void> {
  try { await client.post(path, body); }
  catch (error) {
    if (!(error instanceof MatrixError) || error.status !== 401 || typeof error.body.session !== 'string') throw error;
    await client.post(path, { ...body, auth: { type: 'm.login.password', identifier: { type: 'm.id.user', user }, password, session: error.body.session } });
  }
}
async function login(s: Settings, password: string): Promise<Matrix> {
  const account = await new Matrix(s.homeserver).post<Account>(API + '/login', {
    type: 'm.login.password', identifier: { type: 'm.id.user', user: s.observer }, password,
  });
  return new Matrix(s.homeserver, account.access_token);
}

try {
  console.log('Building the Docker image and starting isolated verification instances.');
  await run('build');
  const example = readJson<InstanceConfig>(join(ROOT, 'examples/project-one.json'));
  const configs: InstanceConfig[] = [];
  for (const id of ['startup-first', 'startup-second']) {
    const [matrix_port, web_port] = await ports();
    const config = { ...example, id, server_name: id + '.localhost', matrix_port, web_port };
    configs.push(config);
    const output = await start(config);
    assert(output.includes('crossfire-install'));
    const installation = await execute(process.execPath, bootstrapArguments(settings(id)), { env, cwd: directory });
    assert.equal(JSON.parse(installation.stdout).instance, id);
  }
  console.log('PASS startup prints working HTTP onboarding for two independent instances.');
  const [first, second] = configs;
  const s = settings(first.id), other = settings(second.id);
  const denied = await fetch(s.room_service + '/_coord/client', { headers: { Authorization: 'Bearer ' + other.registration_token } });
  assert.equal(denied.status, 401);
  await denied.text();
  const verification = await execute(process.execPath, [join(ROOT, 'scripts/verify.ts'), '--instance', first.id, '--secondary', second.id, '--skill-dir', skill],
    { env, cwd: directory, maxBuffer: 4 * 1024 * 1024 });
  const verified = JSON.parse(verification.stdout) as { checks: string[] };
  console.log(`PASS ${verified.checks.length} messaging, file, room-permission, UI, and instance-isolation checks.`);
  for (const agent of ['recovery-a', 'recovery-b']) await chat(first.id, agent, 'init');
  const accountPath = join(clientConfig, 'accounts', first.id, 'recovery-a.json');
  const savedAgent = readJson<Account>(accountPath);
  await execute(process.execPath, bootstrapArguments(s), { env, cwd: directory });
  assert.deepEqual(readJson<Account>(accountPath), savedAgent);
  const send = () => chat(first.id, 'recovery-a', 'send', '--to', 'recovery-b', '--message', 'Recovery verification.');
  const before = await send();
  const file = join(directory, 'retained.txt'); writeFileSync(file, 'Attachment retained after all sessions were revoked.');
  const attachment = await chat(first.id, 'recovery-a', 'upload', file, '--to', 'recovery-b');
  const originalRooms = s.rooms.map(room => room.room_id);
  const initial = readJson<Account>(join(privatePath(first.id), 'admin.json'));
  let human = await login(s, initial.password!);
  await human.post(API + '/logout', {});
  assert.equal((await send()).room_id, before.room_id);
  const previousControl = control(first.id).access_token;
  await new Matrix(s.homeserver, previousControl).post(API + '/logout', {});
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => send()));
  assert(concurrent.every(message => message.room_id === before.room_id));
  assert.notEqual(control(first.id).access_token, previousControl);
  console.log('PASS browser logout and control-session revocation recover during live use.');
  human = await login(s, initial.password!);
  const password = randomBytes(30).toString('base64url');
  await passwordAction(human, API + '/account/password', { new_password: password, logout_devices: true }, s.observer, initial.password!);
  await assert.rejects(login(s, initial.password!));
  assert.equal((await send()).room_id, before.room_id);
  console.log('PASS password changes do not require updating server credentials.');
  // Revoke every observer device, including the control device and this caller.
  // Bulk device deletion is supported by the pinned Conduit release.
  const devices = await human.get<{ devices: { device_id: string }[] }>(API + '/devices');
  await passwordAction(human, API + '/delete_devices', { devices: devices.devices.map(device => device.device_id) }, s.observer, password);
  await stop(first.id);
  await start(first);
  assert.deepEqual(settings(first.id).rooms.map(room => room.room_id), originalRooms);
  assert.equal((await send()).room_id, before.room_id);
  const admin = new Matrix(s.homeserver, control(first.id).access_token);
  const event = await admin.get(`${API}/rooms/${segment(String(before.room_id))}/event/${segment(String(before.event_id))}`);
  assert.equal(event.event_id, before.event_id);
  const received = join(directory, 'received.txt');
  await chat(first.id, 'recovery-b', 'download', String(attachment.mxc), received);
  assert.equal(readFileSync(received, 'utf8'), readFileSync(file, 'utf8'));
  console.log('PASS restart after revoking all observer devices preserves rooms, messages, and files.');
  await stop(first.id);
  rmSync(join(privatePath(first.id), 'control-key.json'));
  rmSync(join(privatePath(first.id), 'control-session.json'));
  await start(first);
  assert.equal((await send()).room_id, before.room_id);
  assert.deepEqual(settings(first.id).rooms.map(room => room.room_id), originalRooms);
  console.log('PASS an existing database gains control credentials without a valid old token or password.');
  console.log('Startup, onboarding, and recovery verification passed.');
} finally {
  await Promise.all([...processes.keys()].map(stop));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(signal, cancel);
  rmSync(directory, { recursive: true, force: true });
}
