import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Lease, LEASE_TIMEOUT_MS } from './lease.ts';
import { runArguments } from './manage.ts';
import { ROOT, validate, type InstanceConfig } from './instance.ts';

const execute = promisify(execFile);
const example = (): InstanceConfig => JSON.parse(readFileSync(join(ROOT, 'examples/project-one.json'), 'utf8'));

test('a disappeared controller expires; stale or unrelated heartbeats cannot extend its lease', () => {
  const lease = new Lease('current', 0);
  lease.observe({ run_id: 'current', sequence: 1 }, 1000);
  lease.observe({ run_id: 'previous', sequence: 1000 }, LEASE_TIMEOUT_MS);
  lease.observe({ run_id: 'current', sequence: 1 }, LEASE_TIMEOUT_MS);
  assert.equal(lease.expired(LEASE_TIMEOUT_MS), false);
  assert.equal(lease.expired(LEASE_TIMEOUT_MS + 1000), true);
  const active = new Lease('new', 0);
  active.observe({ run_id: 'new', sequence: 2 }, 20_000);
  assert.equal(active.expired(40_000), false);
  active.observe({ run_id: 'new', sequence: 3, stopped: true }, 40_001);
  assert.equal(active.expired(40_001), true);
});

test('container arguments publish loopback ports and preserve data without background restart', () => {
  const config = validate(example());
  const args = runArguments(config, '/data/a folder, with "quotes" and $ %', 'test-image', 'test-run');
  assert(args.includes('--rm'));
  assert(!args.includes('--detach'));
  assert(!args.includes('--restart'));
  assert(!args.includes('--privileged'));
  const publications = args.flatMap((value, index) => value === '--publish' ? [args[index + 1]] : []);
  assert.deepEqual(publications, ['127.0.0.1:6167:6167', '127.0.0.1:8088:8088']);
  assert(args[args.indexOf('--mount') + 1].includes('"source=/data/a folder, with ""quotes"" and $ %"'));
  assert(args.includes('--read-only'));
});

test('exported client installs with custom paths, survives reinstall, and runs outside the checkout', async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'crossfire-portable-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const data = join(temporary, 'runtime data');
  const profile = join(data, 'instances/project-one/private');
  const skill = join(temporary, 'skill with spaces');
  const config = join(temporary, 'client config');
  const state = join(temporary, 'client state');
  const workspace = join(temporary, 'unrelated project');
  mkdirSync(profile, { recursive: true }); mkdirSync(workspace);
  writeFileSync(join(workspace, 'package.json'), '{"type":"commonjs"}');
  const accessToken = randomUUID();
  const adminPassword = randomUUID();
  const adminToken = randomUUID();
  let authorizedRequests = 0;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer ' + accessToken) { response.writeHead(401); response.end('{}'); return; }
    authorizedRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ joined: { '@coordinator:project-one.localhost': {}, '@agent-worker-a:project-one.localhost': {} } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address === 'object');
  const settings = { instance: 'project-one', label: 'Project One', server_name: 'project-one.localhost',
    homeserver: `http://127.0.0.1:${address.port}`, room_service: `http://127.0.0.1:${address.port}`,
    observer: '@coordinator:project-one.localhost', observer_label: 'Coordinator', registration_token: randomUUID(),
    room_id: '!example:project-one.localhost', room_alias: '#coordination:project-one.localhost', max_upload_bytes: 104857600 };
  writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(profile, 'admin.json'), JSON.stringify({ password: adminPassword, access_token: adminToken }));
  const env = { ...process.env, CROSSFIRE_DATA_DIR: data };
  const bundle = join(temporary, 'export with spaces');
  await execute(process.execPath, [join(ROOT, 'crossfire'), 'export-client', 'project-one', bundle], { env, cwd: workspace });
  const exported = readFileSync(join(bundle, 'client.json'), 'utf8');
  assert(!exported.includes(adminPassword)); assert(!exported.includes(adminToken));
  const install = [join(bundle, 'install.mts'), join(bundle, 'client.json'), '--skill-dir', skill, '--config-dir', config, '--state-dir', state];
  await execute(process.execPath, install, { cwd: workspace });
  mkdirSync(join(config, 'accounts/project-one'), { recursive: true });
  const account = { user_id: '@agent-worker-a:project-one.localhost', access_token: accessToken, device_id: 'test' };
  const accountPath = join(config, 'accounts/project-one/worker-a.json');
  writeFileSync(accountPath, JSON.stringify(account));
  await execute(process.execPath, install, { cwd: workspace });
  assert.deepEqual(JSON.parse(readFileSync(accountPath, 'utf8')), account);
  assert(!existsSync(join(skill, 'node_modules')));
  assert(!existsSync(join(skill, 'scripts/node_modules')));
  const result = await execute(process.execPath, [join(skill, 'scripts/chat.mjs'), '--instance', 'project-one', '--agent', 'worker-a', 'who'], { cwd: workspace });
  assert.equal(authorizedRequests, 1);
  assert(JSON.parse(result.stdout).members[settings.observer]);
  assert.deepEqual(JSON.parse(readFileSync(join(skill, 'scripts/.client-paths.json'), 'utf8')), { config_dir: config, state_dir: state });
  if (process.platform !== 'win32') assert.equal(statSync(join(config, 'instances/project-one.json')).mode & 0o777, 0o600);
});
