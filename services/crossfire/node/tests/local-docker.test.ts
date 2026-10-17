import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('local stack uses the existing runtime and the common one-shot migration owner', () => {
  assert.deepEqual(Object.keys(services).sort(), ['crossfire', 'fleetd', 'initialize', 'migrate']);
  assert.match(String(service('crossfire').image), /CROSSFIRE_RUNTIME_IMAGE:\?Set the exact csharp-nativeaot/u);
  assert.equal(service('migrate').image, service('initialize').image);
  assert.match(String(service('migrate').image), /CROSSFIRE_MIGRATION_IMAGE:\?/u);
  assert.deepEqual(service('initialize').entrypoint, ['node', '/app/services/crossfire/crossfire']);
  assert.equal(service('migrate').command, undefined);
  for (const property of ['command', 'entrypoint', 'build']) assert.equal(service('crossfire')[property], undefined);
  for (const name of ['initialize', 'migrate', 'crossfire']) assert.deepEqual(service(name).volumes, ['server-state:/runtime']);
});

test('browser and fleet use the same canonical loopback origin and a different content host', () => {
  assert.equal(service('fleetd').network_mode, undefined);
  assert.deepEqual(service('fleetd').entrypoint, ['/opt/ctlflow/start-local.sh']);
  assert.deepEqual(service('crossfire').ports, ['127.0.0.1:8080:8080', '127.0.0.1:8082:8082']);
  const command = service('initialize').command; assert(Array.isArray(command));
  assert.equal(command[command.indexOf('--origin') + 1], 'http://127.0.0.1:8080');
  assert.equal(command[command.indexOf('--content-origin') + 1], 'http://localhost:8082');
  assert.equal(service('fleetd').ports, undefined);
  assert.equal(service('fleetd').extra_hosts, undefined);
  assert.equal(record(record(service('fleetd').depends_on).crossfire).condition, 'service_healthy');
  const relay = readFileSync(new URL('services/fleetd/docker/node/start-local.sh', root), 'utf8');
  assert(relay.includes('TCP4-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork TCP4:crossfire:8080'));
  assert(relay.includes('TCP4-LISTEN:8082,bind=127.0.0.1,reuseaddr,fork TCP4:crossfire:8082'));
  assert(!relay.includes('6167')); assert(!relay.includes('8081'));
  assert(relay.includes('exec "$@"'));
});

test('local volumes and containers retain private state without host credentials or daemon access', () => {
  assert.deepEqual(Object.keys(record(configuration.volumes)).sort(), ['fleet-home', 'server-state']);
  assert.deepEqual(service('fleetd').volumes, ['fleet-home:/home/node']);
  assert.equal(service('fleetd').init, true);
  for (const value of Object.values(services)) {
    const current = record(value);
    assert.equal(current.read_only, true);
    assert.deepEqual(current.cap_drop, ['ALL']);
    assert.deepEqual(current.security_opt, ['no-new-privileges:true']);
    assert.equal(current.mem_limit, '2g'); assert.equal(current.pids_limit, 512);
    for (const property of ['privileged', 'env_file', 'environment', 'userns_mode']) assert.equal(current[property], undefined);
    assert(!JSON.stringify(current).includes('docker.sock'));
  }
  for (const name of ['initialize', 'migrate']) assert.equal(service(name).network_mode, 'none');
});

test('fleet image installs only packaged Node products and explicitly checked native prerequisites', () => {
  const dockerfile = readFileSync(new URL('services/fleetd/docker/node/Dockerfile', root), 'utf8');
  assert.match(dockerfile, /npm pack --workspace=@ctlflow\/fleetd --workspace=@ctlflow\/fleet/u);
  assert.match(dockerfile, /--userconfig \/app\/\.npmrc --omit=dev --ignore-scripts/u);
  assert.match(dockerfile, /@openai\/codex@0\.162\.0 @earendil-works\/pi-coding-agent@1\.0\.0/u);
  assert.match(dockerfile, /RUN node services\/fleetd\/docker\/node\/verify-native\.mjs/u);
  const checks = readFileSync(new URL('services/fleetd/docker/node/verify-native.mjs', root), 'utf8');
  for (const check of ['instructionCapability', 'ownedQuestionCapability', 'ownedVersion', 'piVersion']) assert(checks.includes(check));
  assert(checks.includes('generate-json-schema')); assert(checks.includes('--experimental'));
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
  assert.match(runtime, /USER node/u); assert.match(runtime, /chmod 0700 \/home\/node/u);
  assert.match(runtime, /CMD \["fleetd", "--root", "\/home\/node\/\.ctlflow\/controller", "--name", "local-docker"\]/u);
  const defaultCommand = /^CMD (\[.*\])$/mu.exec(runtime);
  assert(defaultCommand);
  assert.deepEqual(service('fleetd').command, JSON.parse(defaultCommand[1]!));
  assert(!/^COPY services \.\/services$/mu.test(runtime)); assert(!runtime.includes('COPY . '));
  assert(!runtime.includes('CODEX_THREAD_ID')); assert(!dockerfile.includes('latest'));
  const composeDirectory = new URL('services/crossfire/docker/local/', root);
  const dockerContext = fileURLToPath(new URL(String(record(service('fleetd').build).context) + '/', composeDirectory));
  assert.equal(dockerContext, fileURLToPath(root));
  const ignored = readFileSync(new URL('.dockerignore', root), 'utf8').split('\n');
  for (const name of ['.git', '.analysis', '**/.analysis', '.temp', '**/.temp', 'private', 'instances', 'node_modules']) assert(ignored.includes(name));
});
