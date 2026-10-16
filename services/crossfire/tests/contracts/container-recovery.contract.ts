import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
