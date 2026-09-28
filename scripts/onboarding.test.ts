import test from 'node:test';
import assert from 'node:assert/strict';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ROOT, type InstanceConfig } from './instance.ts';
import { serve } from './room-service.ts';
import { enrollmentUrl, onboarding } from './onboarding.ts';
import { Matrix, type Settings } from '../skills/conduit-chat/scripts/lib.ts';
import { buildInfo } from './version.ts';

const execute = promisify(execFile);
const shell = promisify(exec);

test('printed HTTP onboarding installs outside the checkout, authenticates the instance, and preserves accounts on repeat', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-onboarding-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const profile = join(directory, 'runtime/instances/project-one/private');
  mkdirSync(profile, { recursive: true });
  const config: InstanceConfig = JSON.parse(readFileSync(join(ROOT, 'examples/project-one.json'), 'utf8'));
  const settings: Settings = { instance: config.id, label: config.label, server_name: config.server_name,
    homeserver: 'http://127.0.0.1:6167', room_service: 'http://127.0.0.1:8088',
    observer: '@coordinator:project-one.localhost', observer_label: 'Coordinator',
    registration_token: randomBytes(40).toString('base64url'), max_upload_bytes: config.max_upload_bytes,
    default_room: config.default_room, rooms: config.rooms.map((room, n) => ({ ...room, room_id: '!room-' + n })) };
  const adminSecret = randomUUID(), controlSecret = randomUUID();
  writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(profile, 'admin.json'), JSON.stringify({ password: adminSecret, access_token: adminSecret }));
  writeFileSync(join(profile, 'control-key.json'), JSON.stringify({ secret: controlSecret }));
  writeFileSync(join(profile, 'control-session.json'), JSON.stringify({ access_token: controlSecret }));
  const bundlePath = join(directory, 'export');
  await execute(process.execPath, [join(ROOT, 'crossfire'), 'export-client', config.id, bundlePath],
    { env: { ...process.env, CROSSFIRE_DATA_DIR: join(directory, 'runtime') } });
  const files = JSON.parse(readFileSync(join(bundlePath, 'client.json'), 'utf8')).files;
  writeFileSync(join(profile, 'client-files.json'), JSON.stringify(files));
  writeFileSync(join(profile, 'install.mjs'), readFileSync(join(ROOT, 'dist/install.mjs')));
  const startup = { build: buildInfo(ROOT, 'test-image'), started_at: new Date().toISOString(), node: process.versions.node };
  const clientHash = createHash('sha256').update(files['scripts/chat.mjs']).digest('hex');
  const server = serve({ ...config, web_port: 0 }, settings, new Matrix(settings.homeserver), profile, startup);
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  settings.room_service = `http://127.0.0.1:${address.port}`;
  const health = await (await fetch(settings.room_service + '/_coord/health')).json();
  assert.deepEqual(health, { instance: config.id, status: 'ready', ...startup, client_sha256: clientHash });
  assert.deepEqual(await (await fetch(settings.room_service + '/_coord/health')).json(), health);
  assert(!JSON.stringify(health).includes(settings.registration_token));
  const clientUrl = settings.room_service + '/_coord/client';
  for (const headers of [{}, { Authorization: 'Bearer ' + randomBytes(40).toString('base64url') }, { Authorization: 'Bearer ' + controlSecret }]) {
    const response = await fetch(clientUrl, { headers });
    assert.equal(response.status, 401);
    const body = await response.text();
    assert(!body.includes(settings.registration_token));
    assert(!body.includes(controlSecret));
  }
  const response = await fetch(clientUrl, { headers: { Authorization: 'Bearer ' + settings.registration_token } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert(!body.includes(adminSecret)); assert(!body.includes(controlSecret));
  assert.equal(JSON.parse(body).settings.instance, config.id);
  const publicConfig = await (await fetch(settings.room_service + '/config.json')).text();
  assert(!publicConfig.includes(settings.registration_token));

  const workspace = join(directory, 'unrelated project'); mkdirSync(workspace);
  writeFileSync(join(workspace, 'package.json'), '{"type":"commonjs"}');
  const skill = join(directory, 'agent skill'), clientConfig = join(directory, 'client config'), state = join(directory, 'client state');
  const env = { ...process.env, CROSSFIRE_SKILL_DIR: skill, CROSSFIRE_CLIENT_CONFIG_DIR: clientConfig, CROSSFIRE_CLIENT_STATE_DIR: state };
  const command = onboarding(settings).split('\n').find(line => line.startsWith('node --input-type=module'))!;
  assert(command.includes(enrollmentUrl(settings)));
  const installed = JSON.parse((await shell(command, { env, cwd: workspace })).stdout);
  assert.equal(installed.instance, config.id);
  assert.equal(installed.skill_file, join(skill, 'SKILL.md'));
  assert.equal(installed.node_version, process.versions.node);
  assert.equal(installed.client_sha256, clientHash);
  assert.equal(createHash('sha256').update(readFileSync(installed.chat)).digest('hex'), clientHash);
  assert.equal(readFileSync(join(skill, 'licenses/matrix-spec.txt'), 'utf8'), readFileSync(join(ROOT, 'third-party/matrix-spec-LICENSE'), 'utf8'));
  assert(onboarding(settings).includes('Node.js 26+'));
  const accountPath = join(clientConfig, 'accounts/project-one/worker-a.json');
  mkdirSync(join(clientConfig, 'accounts/project-one'), { recursive: true });
  const account = { user_id: '@agent-worker-a:project-one.localhost', access_token: randomUUID(), device_id: 'existing' };
  writeFileSync(accountPath, JSON.stringify(account));
  mkdirSync(join(state, 'project-one/worker-a'), { recursive: true });
  const cursor = join(state, 'project-one/worker-a/cursors.json');
  writeFileSync(cursor, '{"existing":"position"}');
  const olderInstance = join(clientConfig, 'instances/older-project.json');
  writeFileSync(olderInstance, '{"preserve":true}');
  settings.rooms[0].purpose = 'Updated purpose on reinstall.';
  await shell(command, { env, cwd: workspace });
  assert.deepEqual(JSON.parse(readFileSync(accountPath, 'utf8')), account);
  assert.equal(readFileSync(cursor, 'utf8'), '{"existing":"position"}');
  assert.equal(readFileSync(olderInstance, 'utf8'), '{"preserve":true}');
  assert.equal(JSON.parse(readFileSync(join(clientConfig, 'instances/project-one.json'), 'utf8')).rooms[0].purpose, settings.rooms[0].purpose);
  assert(!existsSync(join(skill, 'node_modules')));
  for (const invalid of [{ ...JSON.parse(body), format: 3 },
    { ...JSON.parse(body), files: { ...files, '../unwanted': 'no' } }]) {
    const invalidFile = join(directory, 'invalid-bundle.json');
    writeFileSync(invalidFile, JSON.stringify(invalid));
    await assert.rejects(execute(process.execPath, [join(ROOT, 'dist/install.mjs'), invalidFile], { env, cwd: workspace }), /Invalid Crossfire client bundle|unexpected files/);
    assert.deepEqual(JSON.parse(readFileSync(accountPath, 'utf8')), account);
  }
  const badLink = settings.room_service + '/_coord/client#' + randomBytes(40).toString('base64url');
  await assert.rejects(execute(process.execPath, [join(ROOT, 'dist/install.mjs'), badLink], { env, cwd: workspace }), /HTTP 401/);
  await assert.rejects(execute(process.execPath, [join(ROOT, 'dist/install.mjs'), enrollmentUrl(settings).replace('127.0.0.1', 'example.com')], { env }), /loopback/);
});
