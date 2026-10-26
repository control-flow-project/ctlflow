import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { contractProcess, freePorts, observe, record, text, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { contractHttp } from '@ctlflow/crossfire-test-support/contract-http';
import { secureProxy } from '@ctlflow/crossfire-test-support/tls';
import { builtRelease } from '../../node/scripts/test-support/release.js';
import { prepareContainerPackage } from '../../node/scripts/container-package.js';
import { contractClient } from './fixture.js';
import { config as parseConfiguration } from '../../node/apps/server/src/config.js';

export type ContainerStack = Awaited<ReturnType<typeof containerStack>>;
export async function containerStack(scope: TestContext, initial: ContractTarget, targets: readonly ContractTarget[], packages: string) {
  const parent = process.env.CROSSFIRE_TEST_CGROUP_PARENT;
  assert(parent && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.slice$/u.test(parent), 'Use the finite Docker verification slice');
  const repository = resolve(process.cwd(), '../..'), fixtureRoot = join(repository, 'services/crossfire/.temp');
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(fixtureRoot, 'container-')), state = join(directory, 'state');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true })); mkdirSync(state, { mode: 0o700 });
  const [port, contentPort] = await freePorts(scope), { origin } = await secureProxy(scope, 'http://127.0.0.1:' + port), contentOrigin = 'http://localhost:' + contentPort;
  const initialized = contractProcess(scope, initial.server, ['init', '--directory', state, '--instance', 'verification', '--origin', origin, '--content-origin', contentOrigin, '--server-name', 'verification.localhost', '--administrator', 'admin'], repository);
  assert.equal(await initialized.ended, 0, initialized.errors() + '\n' + initialized.output());
  const parsed = parseConfiguration(JSON.parse(readFileSync(join(state, 'config.json'), 'utf8')) as unknown);
  assert(parsed.ok, parsed.ok ? '' : parsed.error.message);
  const configuration = parsed.value;
  const bootstrap = record(JSON.parse(readFileSync(join(state, 'bootstrap.json'), 'utf8')) as unknown);
  const project = 'crossfire-test-' + randomUUID().slice(0, 12), containerName = project + '-crossfire-1';
  let selected = initial, composeFile = join(packages, initial.name, 'compose.yaml');
  let environment: NodeJS.ProcessEnv | undefined;
  async function compose(arguments_: string[], override?: string) {
    assert(environment, 'Compose images and state must be explicitly selected');
    const command = contractProcess(scope, { binary: 'docker', arguments: [] }, ['compose', '--project-name', project, '-f', composeFile,
      ...(override ? ['-f', override] : []), ...arguments_], directory, environment, 300000);
    const status = await command.ended;
    assert.equal(status, 0, command.errors() + '\n' + command.output());
    return command.output().trim();
  }
  const close = () => environment ? compose(['stop', 'crossfire']).then(() => {}) : Promise.resolve();
  cleanup(scope, () => environment ? compose(['down', '--remove-orphans']).then(() => {}) : undefined);
  async function start(target: ContractTarget, packageDirectory = join(packages, target.name)) {
    // Verify transferred artifacts before stopping any current writer.
    const prepared = await prepareContainerPackage(packageDirectory, scope.signal);
    await close();
    composeFile = join(packageDirectory, 'compose.yaml'); selected = target;
    environment = { ...process.env, CTLFLOW_CGROUP_PARENT: parent, CROSSFIRE_STATE: state,
      CROSSFIRE_RUNTIME_IMAGE: prepared.runtimeImage, CROSSFIRE_MIGRATION_IMAGE: prepared.migrationImage,
      CROSSFIRE_PORT: String(port), CROSSFIRE_CONTENT_PORT: String(contentPort) };
    await compose(['rm', '-f', 'migrate']);
    await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '180']);
    await observe(async () => {
      try { return (await contractHttp(origin, 'GET', '/api/health')).status === 200; } catch { return false; }
    }, 'Compose runtime must become ready: ' + target.name, 180000);
  }
  await start(initial);
  const client = await contractClient({ directory, state, origin, contentOrigin, configuration, bootstrap: { administratorPassword: text(bootstrap.administratorPassword) }, native: { base: origin }, targets, release: builtRelease(),
    restart: (target = selected) => start(target), close, current: () => selected });
  return { ...client, port, contentPort, containerName, start, compose, packages };
}
