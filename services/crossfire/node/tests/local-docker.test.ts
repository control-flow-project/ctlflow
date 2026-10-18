import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const root = new URL('../../../../', import.meta.url);
function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
const configuration = record(parse(readFileSync(new URL('services/crossfire/docker/local/compose.yaml', root), 'utf8'), { merge: true }) as unknown);
const services = record(configuration.services);
const service = (name: string) => record(services[name]);

test('local Docker runs only the server and the common one-shot maintenance owner', () => {
  assert.deepEqual(Object.keys(services).sort(), ['crossfire', 'initialize', 'migrate']);
  assert.match(String(service('crossfire').image), /CROSSFIRE_RUNTIME_IMAGE:\?Set the exact selected runtime image/u);
  assert.equal(service('migrate').image, service('initialize').image);
  assert.match(String(service('migrate').image), /CROSSFIRE_MIGRATION_IMAGE:\?/u);
  assert.deepEqual(service('initialize').entrypoint, ['node', '/app/services/crossfire/crossfire']);
  assert.equal(service('migrate').command, undefined);
  for (const property of ['command', 'entrypoint', 'build']) assert.equal(service('crossfire')[property], undefined);
  for (const name of ['initialize', 'migrate', 'crossfire']) assert.deepEqual(service(name).volumes, ['server-state:/runtime']);
});

test('the host browser and fleet use the public loopback origin with a separate content host', () => {
  assert.deepEqual(service('crossfire').ports, ['127.0.0.1:8080:8080', '127.0.0.1:8082:8082']);
  const command = service('initialize').command; assert(Array.isArray(command));
  assert.equal(command[command.indexOf('--origin') + 1], 'http://127.0.0.1:8080');
  assert.equal(command[command.indexOf('--content-origin') + 1], 'http://localhost:8082');
  assert.equal(service('crossfire').network_mode, undefined);
  assert.equal(service('crossfire').extra_hosts, undefined);
  assert.equal(service('crossfire').depends_on, undefined);
});

test('the server volume and containers exclude host logins, fleet state and daemon access', () => {
  assert.deepEqual(Object.keys(record(configuration.volumes)), ['server-state']);
  for (const value of Object.values(services)) {
    const current = record(value);
    assert.equal(current.read_only, true);
    assert.deepEqual(current.cap_drop, ['ALL']);
    assert.deepEqual(current.security_opt, ['no-new-privileges:true']);
    assert.equal(current.mem_limit, '2g'); assert.equal(current.pids_limit, 512);
    for (const property of ['privileged', 'env_file', 'environment', 'userns_mode']) assert.equal(current[property], undefined);
    assert(!JSON.stringify(current).includes('docker.sock'));
    assert(!JSON.stringify(current).includes('/home/'));
  }
  for (const name of ['initialize', 'migrate']) assert.equal(service(name).network_mode, 'none');
});

test('fleet images, relays and their alternative container entrypoints are removed', () => {
  for (const name of ['Dockerfile', 'start-local.sh', 'verify-native.mjs', 'container.test.mjs']) {
    assert.equal(existsSync(new URL('services/fleetd/docker/node/' + name, root)), false, name);
  }
  assert.equal(services.fleetd, undefined);
  assert(!JSON.stringify(configuration).includes('CTLFLOW_FLEET_IMAGE'));
  const ignored = readFileSync(new URL('.dockerignore', root), 'utf8').split('\n');
  for (const name of ['.git', '.analysis', '**/.analysis', '.temp', '**/.temp', 'private', 'instances', 'node_modules']) assert(ignored.includes(name));
});
