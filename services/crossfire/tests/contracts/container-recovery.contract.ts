import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { observe } from '@ctlflow/crossfire-test-support/contract-process';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { ContainerStack } from './container-fixture.js';

export async function containerRecoveryContracts(scope: TestContext, fixture: ContainerStack): Promise<void> {
  function docker(args: string[]): string {
    const command = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
    assert.equal(command.status, 0, command.stderr); return command.stdout.trim();
  }
  const inspect = (identity: string, format: string) => docker(['inspect', '--format', format, identity]);
  const exists = (identity: string) => docker(['container', 'ls', '--all', '--no-trunc', '--filter', 'id=' + identity, '--format', '{{.ID}}']) !== '';
  await scope.test('a transferred derivative package imports its missing image and retains image-owned readiness', async () => {
    const original = fixture.current(), parent = inspect(fixture.containerName, '{{.Config.Image}}');
    const metadata = JSON.parse(readFileSync(join(fixture.packages, original.name, 'release.json'), 'utf8')) as { migrationImage: string };
    const temporary = mkdtempSync(join(fixture.directory, 'transfer-')), child = docker(['create', '--label', 'org.crossfire.directory=' + fixture.state, '--cgroup-parent', process.env.CROSSFIRE_TEST_CGROUP_PARENT!, parent]);
    let derivative: string | undefined;
    try {
      derivative = docker(['commit', '--change', 'LABEL org.crossfire.transfer=' + child, child]); docker(['rm', child]);
      const output = join(temporary, 'package');
      const exported = spawnSync(process.execPath, [join(fixture.packages, original.name, 'package-tool.mjs'), 'export', '--runtime', derivative, '--migrations', metadata.migrationImage, '--output', output], { cwd: temporary, encoding: 'utf8', timeout: 300000 });
      assert.equal(exported.status, 0, exported.stderr);
      docker(['image', 'rm', '--no-prune', derivative]);
      assert.notEqual(spawnSync('docker', ['image', 'inspect', derivative], { stdio: 'ignore' }).status, 0, 'The receiving operator must actually load the archive');
      await fixture.close(); await fixture.start(original, output);
      assert.equal(inspect(fixture.containerName, '{{.Config.Image}}'), derivative); await fixture.operation(operations.currentSession);
      const verified = spawnSync(process.execPath, [join(output, 'package-tool.mjs'), 'verify', output], { cwd: temporary, encoding: 'utf8', timeout: 300000 });
      assert.equal(verified.status, 0, verified.stderr);
      assert.equal((JSON.parse(verified.stdout) as { runtimeImage: string }).runtimeImage, derivative, 'The standalone package tool resolves no monorepo source');
      const health = JSON.parse(inspect(fixture.containerName, '{{json .Config.Healthcheck.Test}}')) as string[]; assert.equal(health[0], 'CMD'); docker(['exec', fixture.containerName, ...health.slice(1)]);
    } finally {
      await fixture.close();
      if (exists(child)) docker(['rm', child]);
      if (derivative && spawnSync('docker', ['image', 'inspect', derivative], { stdio: 'ignore' }).status === 0) docker(['image', 'rm', '--no-prune', derivative]);
      rmSync(temporary, { recursive: true, force: true }); await fixture.start(original);
    }
  });
  await scope.test('every installed operator runs every backend package without a source checkout or data conversion', async () => {
    const original = fixture.current();
    for (const operator of fixture.targets) for (const backend of fixture.targets) {
      await fixture.close(); await fixture.start(operator, join(fixture.packages, backend.name));
      const manifest = JSON.parse(readFileSync(join(fixture.packages, backend.name, 'release.json'), 'utf8')) as { runtimeImage: string };
      assert.equal(inspect(fixture.containerName, '{{.Config.Image}}'), manifest.runtimeImage);
      await fixture.operation(operations.currentSession);
      const health = JSON.parse(inspect(fixture.containerName, '{{json .Config.Healthcheck.Test}}')) as string[];
      assert.equal(health[0], 'CMD'); docker(['exec', fixture.containerName, ...health.slice(1)]);
    }
    await fixture.restart(original);
  });
  await scope.test('corrupt archives and mismatched image labels cannot stop an existing runtime orphan', async () => {
    const original = fixture.current(), temporary = mkdtempSync(join(fixture.directory, 'bad-package-'));
    try {
      for (const operator of fixture.targets) for (const failure of ['archive', 'labels']) {
        const path = join(temporary, operator.name + '-' + failure); mkdirSync(path);
        const source = join(fixture.packages, operator.name), manifest = JSON.parse(readFileSync(join(source, 'release.json'), 'utf8')) as Record<string, unknown>;
        if (failure === 'archive') writeFileSync(join(path, 'images.tar'), 'corrupt archive');
        else { linkSync(join(source, 'images.tar'), join(path, 'images.tar')); manifest.backend = 'incorrect-backend'; }
        writeFileSync(join(path, 'release.json'), JSON.stringify(manifest));
        const identity = inspect(fixture.containerName, '{{.Id}}'); await fixture.abandon();
        const contender = fixture.launch(operator, path); await observe(() => !contender.alive(), 'Invalid package fails before stopping writers', 60000);
        assert.notEqual(await contender.ended, 0); assert.match(contender.errors(), failure === 'archive' ? /SHA-256/u : /release labels/u);
        assert.equal(inspect(identity, '{{.State.Status}}'), 'running'); await fixture.start(operator);
      }
    } finally { rmSync(temporary, { recursive: true, force: true }); await fixture.restart(original); }
  });
  await scope.test('a second live operator cannot stop, migrate or replace this instance', async () => {
    const identity = inspect(fixture.containerName, '{{.Id}}');
    for (const target of fixture.targets) {
      const contender = fixture.launch(target); await observe(() => !contender.alive(), 'Concurrent start must fail promptly');
      assert.notEqual(await contender.ended, 0); assert.match(contender.errors(), /already owns this private state/u);
      assert.equal(inspect(fixture.containerName, '{{.Id}}'), identity); await fixture.operation(operations.currentSession);
    }
  });
  await scope.test('a killed launcher leaves an exact running or exited runtime that another implementation reconciles', async () => {
    const original = fixture.current();
    for (const state of ['running', 'exited']) for (const target of fixture.targets) {
      const identity = inspect(fixture.containerName, '{{.Id}}'); await fixture.abandon();
      if (state === 'exited') docker(['stop', '--timeout', '15', identity]);
      assert.equal(inspect(identity, '{{.State.Status}}'), state);
      await fixture.start(target); assert.equal(exists(identity), false); assert.notEqual(inspect(fixture.containerName, '{{.Id}}'), identity);
      await fixture.operation(operations.currentSession);
    }
    await fixture.restart(original);
  });
  await scope.test('running and exited migration orphans are removed before the same database restarts', async () => {
    const image = inspect(fixture.containerName, '{{.Config.Image}}');
    const name = 'crossfire-migration-' + createHash('sha256').update(fixture.state).digest('hex').slice(0, 16);
    const resources = ['--cgroup-parent', process.env.CROSSFIRE_TEST_CGROUP_PARENT!];
    for (const state of ['running', 'exited']) {
      await fixture.close();
      const identity = docker(['create', '--name', name, '--label', 'org.crossfire.directory=' + fixture.state, ...resources, '--network', 'none', '--read-only', '--entrypoint', '/bin/sh', image, '-c', state === 'running' ? 'exec tail -f /dev/null' : 'exit 0']);
      try {
        docker(['start', identity]); await observe(() => inspect(identity, '{{.State.Status}}') === state, 'Migration fixture reaches its selected orphan state');
        await fixture.start(fixture.current()); assert.equal(exists(identity), false); await fixture.operation(operations.currentSession);
      } finally { if (exists(identity)) docker(['rm', '--force', identity]); }
    }
  });
  await scope.test('foreign migration ownership refuses takeover without stopping an owned runtime orphan', async () => {
    const runtime = inspect(fixture.containerName, '{{.Id}}'), image = inspect(runtime, '{{.Config.Image}}');
    const name = 'crossfire-migration-' + createHash('sha256').update(fixture.state).digest('hex').slice(0, 16);
    await fixture.abandon();
    const foreign = docker(['create', '--name', name, '--label', 'org.crossfire.directory=/foreign-instance', '--cgroup-parent', process.env.CROSSFIRE_TEST_CGROUP_PARENT!, '--network', 'none', '--read-only', '--entrypoint', '/bin/true', image]);
    try {
      const contender = fixture.launch(fixture.current()); await observe(() => !contender.alive(), 'Foreign ownership must fail explicitly');
      assert.notEqual(await contender.ended, 0); assert.match(contender.errors(), /different ownership/u);
      assert.equal(inspect(runtime, '{{.State.Status}}'), 'running'); assert.equal(exists(foreign), true);
    } finally { docker(['rm', foreign]); await fixture.start(fixture.current()); }
  });
}
