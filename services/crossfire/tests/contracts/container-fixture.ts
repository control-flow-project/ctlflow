import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { contractProcess, freePorts, observe, record, text, type ContractProcess, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { contractHttp } from '@ctlflow/crossfire-test-support/contract-http';
import { secureProxy } from '../../node/tests/support/tls.js';
import { builtRelease } from '../../node/scripts/test-support/release.js';
import { contractClient } from './fixture.js';

export type ContainerStack = Awaited<ReturnType<typeof containerStack>>;
export async function containerStack(scope: TestContext, initial: ContractTarget, targets: readonly ContractTarget[]) {
  const parent = process.env.CROSSFIRE_TEST_CGROUP_PARENT;
  assert(parent && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.slice$/u.test(parent), 'Use the finite Docker verification slice');
  const repository = resolve(process.cwd(), '../..'), directory = mkdtempSync(join(tmpdir(), 'cf-container-')), state = join(directory, 'state');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true })); mkdirSync(state, { mode: 0o700 });
  const [port, contentPort] = await freePorts(), { origin } = await secureProxy(scope, 'http://127.0.0.1:' + port), contentOrigin = 'http://localhost:' + contentPort;
  const initialized = contractProcess(scope, initial.server, ['init', '--directory', state, '--instance', 'verification', '--origin', origin, '--content-origin', contentOrigin, '--server-name', 'verification.localhost', '--administrator', 'admin'], repository);
  assert.equal(await initialized.ended, 0, initialized.errors() + '\n' + initialized.output());
  const config = record(JSON.parse(readFileSync(join(state, 'config.json'), 'utf8')) as unknown);
  const configuration = { instance: text(config.instance), serverName: text(config.serverName), publicOrigin: text(config.publicOrigin), contentOrigin: text(config.contentOrigin), matrixOrigin: text(config.matrixOrigin), administrator: text(config.administrator), jwtSecret: text(config.jwtSecret), registrationSecret: text(config.registrationSecret) };
  const bootstrap = record(JSON.parse(readFileSync(join(state, 'bootstrap.json'), 'utf8')) as unknown), containerName = 'crossfire-' + createHash('sha256').update(state).digest('hex').slice(0, 16);
  let selected = initial, running: ContractProcess | undefined;
  const abandoned = new Set<string>();
  cleanup(scope, () => {
    for (const identity of abandoned) {
      const present = execFileSync('docker', ['container', 'ls', '--all', '--no-trunc', '--filter', 'id=' + identity, '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 30000 }).trim();
      if (present) { assert.equal(present, identity); execFileSync('docker', ['rm', '--force', identity], { timeout: 30000 }); }
    }
  });
  async function close() {
    const owned = running; running = undefined; if (!owned) return;
    let failure: unknown;
    try { await owned.close(120000); assert.equal(await owned.ended, 0, owned.errors() + '\n' + owned.output()); }
    catch (error) { failure = error; }
    try {
      if (spawnSync('docker', ['inspect', containerName], { stdio: 'ignore' }).status === 0) {
        execFileSync('docker', ['rm', '--force', containerName], { timeout: 30000 });
        assert.fail('Orderly operator shutdown must remove its exact owned container');
      }
    } catch (error) { failure ??= error; }
    if (failure !== undefined) throw failure;
  }
  cleanup(scope, close);
  function launch(target: ContractTarget) {
    const options: string[] = [];
    if (target.implementation === 'csharp') {
      const distribution = record(JSON.parse(readFileSync(resolve(dirname(target.server.binary), '../distribution.json'), 'utf8')) as unknown);
      assert.equal(distribution.implementation, 'csharp'); assert(distribution.mode === 'managed' || distribution.mode === 'nativeaot');
      options.push('--source', repository, '--runtime', distribution.mode);
    }
    if (target.implementation === 'rust') options.push('--source', repository);
    return contractProcess(scope, target.server, ['start', '--directory', state, '--port', String(port), '--content-port', String(contentPort), '--cgroup-parent', parent!, ...options], repository);
  }
  async function start(target: ContractTarget) {
    selected = target; running = launch(target);
    await observe(async () => {
      assert.equal(running?.alive(), true, 'Container operator must remain running\n' + running?.errors() + '\n' + running?.output());
      if (!running?.output().includes('Public: ' + origin + '/')) return false;
      try { return (await contractHttp(origin, 'GET', '/api/health')).status === 200; } catch { return false; }
    }, 'Owned container must become ready: ' + target.name, 1800000);
  }
  await start(initial);
  const client = await contractClient({ directory, state, origin, contentOrigin, configuration, bootstrap: { administratorPassword: text(bootstrap.administratorPassword) }, native: { base: origin }, targets, release: builtRelease(),
    restart: async (target = selected) => { await close(); await start(target); }, close, current: () => selected });
  return { ...client, port, contentPort, containerName, launch, start,
    async abandon() {
      const owned = running; assert(owned, 'The fixture must own its launcher'); assert(owned.alive(), 'Only the fixture-owned live launcher can be terminated');
      const identity = execFileSync('docker', ['inspect', '--format', '{{.Id}}', containerName], { encoding: 'utf8', timeout: 30000 }).trim();
      assert.match(identity, /^[a-f0-9]{64}$/u); abandoned.add(identity);
      owned.child.kill('SIGKILL'); await owned.ended; running = undefined;
    } };
}
