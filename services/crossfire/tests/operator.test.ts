import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { main, runArguments, cgroupArguments } from '../apps/server/src/operator.js';

test('initialization is private, explicit, non-destructive and rejects unrelated options', async () => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/operator-'));
  const args = ['init', '--directory', directory, '--instance', 'preview', '--origin', 'http://127.0.0.1:8098',
    '--content-origin', 'http://localhost:8099',
    '--server-name', 'preview.localhost', '--administrator', 'admin'];
  await assert.rejects(main([...args, '--compile']), /Invalid option/);
  await assert.rejects(main([...args, '--cgroup-parent', 'app-test.slice']), /Invalid option/);
  await assert.rejects(main(['start', '--directory', directory, '--instance', 'ignored']), /Invalid option/);
  for (const action of ['reset', 'install', 'run', 'kill']) await assert.rejects(main([action]), /Use init or start/);
  await main(args);
  const first = readFileSync(join(directory, 'bootstrap.json'), 'utf8');
  const secrets = JSON.parse(first) as { administratorPassword: string; servicePassword: string };
  assert.equal(secrets.administratorPassword.length, 43);
  assert.notEqual(secrets.administratorPassword, secrets.servicePassword);
  for (const path of [directory, join(directory, 'config.json'), join(directory, 'bootstrap.json')]) assert.equal(statSync(path).mode & 0o077, 0);
  await assert.rejects(main(args), /existing data is never overwritten/);
  assert.equal(readFileSync(join(directory, 'bootstrap.json'), 'utf8'), first);
});

test('explicit container budgets use the exact existing slice without provisioning host services', () => {
  assert.deepEqual(cgroupArguments(), []);
  assert.deepEqual(cgroupArguments('app-test.slice'), ['--cgroup-parent', 'app-test.slice']);
  const args = runArguments('/example', 'fixture-image', 8098, 8099, 'app-test.slice');
  assert.equal(args[args.indexOf('--cgroup-parent') + 1], 'app-test.slice');
  for (const parent of ['', 'app-test.scope', '/app.slice', '../app.slice', '--privileged.slice']) assert.throws(() => cgroupArguments(parent), /existing systemd slice/u);
});

test('container arguments expose only loopback and this explicit state directory', () => {
  const directory = '/example/space , and "quote"';
  const args = runArguments(directory, 'fixture-image', 8098, 8099);
  assert.equal(args[args.indexOf('--publish') + 1], '127.0.0.1:8098:8080');
  assert(args.includes('127.0.0.1:8099:8082'));
  assert.equal(args[args.indexOf('--mount') + 1], 'type=bind,"source=/example/space , and ""quote""",target=/runtime');
  assert(args.includes('--read-only'));
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
  assert.equal(args[args.indexOf('--security-opt') + 1], 'no-new-privileges');
  assert.equal(args.at(-1), 'fixture-image');
  for (const forbidden of ['--privileged', '--network=host', '--pid=host', '/var/run/docker.sock']) assert(!args.includes(forbidden));
  assert.notEqual(runArguments(directory, 'fixture-image', 8098, 8099)[3], runArguments('/different', 'fixture-image', 8098, 8099)[3]);
});
