import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { main } from '../apps/server/src/operator.js';
import { runArguments, cgroupArguments } from '../apps/server/src/container-commands.js';
import { ownedDocker } from '../apps/server/src/container-lifecycle.js';
import { checkContainerConfiguration } from '../scripts/container-configuration.js';

test('initialization is private, explicit, non-destructive and rejects unrelated options', async context => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/operator-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const args = ['init', '--directory', directory, '--instance', 'preview', '--origin', 'http://127.0.0.1:8098',
    '--content-origin', 'http://localhost:8099',
    '--server-name', 'preview.localhost', '--administrator', 'admin'];
  await assert.rejects(main([...args, '--package', '/package']), /Invalid option/);
  for (const option of ['--compile', '--source', '--runtime']) await assert.rejects(main(['start', option, 'old']), /Unknown option/);
  await assert.rejects(main([...args, '--cgroup-parent', 'app-test.slice']), /Invalid option/);
  await assert.rejects(main(['start', '--directory', directory, '--instance', 'ignored']), /Invalid option/);
  for (const action of ['reset', 'install', 'run', 'kill']) await assert.rejects(main([action]), /Use init or start/);
  for (const repeated of [['--instance', 'preview'], ['--instance', 'other'], ['--instance=other']])
    await assert.rejects(main([...args, ...repeated]), /Duplicated option --instance/u);
  const invalidBackend = [...args]; invalidBackend[invalidBackend.indexOf('--server-name') + 1] = 'bad/host';
  await assert.rejects(main(invalidBackend), /Matrix server configuration/u);
  assert.deepEqual(readdirSync(directory), [], 'Invalid backend parameters cannot write configuration or credentials');
  await main(args);
  const configurationArguments = args.slice(1).filter((value, index, values) => value !== '--administrator' && values[index - 1] !== '--administrator');
  const configuration = readFileSync(join(directory, 'config.json'), 'utf8');
  checkContainerConfiguration(configurationArguments);
  assert.throws(() => checkContainerConfiguration([...configurationArguments, '--origin', 'https://different.example']), /deployment identity/u);
  assert.equal(readFileSync(join(directory, 'config.json'), 'utf8'), configuration, 'Maintenance validation cannot rewrite private configuration');
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
  for (const forbidden of ['--rm', '--privileged', '--network=host', '--pid=host', '/var/run/docker.sock']) assert(!args.includes(forbidden));
  const other = runArguments('/different', 'fixture-image', 8098, 8099);
  assert.notEqual(args[args.indexOf('--name') + 1], other[other.indexOf('--name') + 1]);
});

test('one container lifecycle owner rejects automatic removal and cancellation before creation', async () => {
  const args = runArguments('/private/example', 'fixture-image', 8098, 8099), stop = new AbortController();
  for (const option of ['--rm', '--rm=true', '--rm=false']) await assert.rejects(ownedDocker(['run', option, ...args.slice(1)], stop.signal), /without automatic removal/u);
  stop.abort(); await assert.rejects(ownedDocker(args, stop.signal), { name: 'AbortError' });
});
