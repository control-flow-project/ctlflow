import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { ContainerStack } from './container-fixture.js';

export async function containerRecoveryContracts(scope: TestContext, fixture: ContainerStack): Promise<void> {
  const artifactPreparationMilliseconds = 300000;
  function docker(args: string[], timeout = 30000): string {
    const command = spawnSync('docker', args, { encoding: 'utf8', timeout });
    assert.equal(command.error === undefined, true, 'Docker ' + args[0] + ': ' + (command.error?.message ?? ''));
    assert.equal(command.status, 0, command.stderr); return command.stdout.trim();
  }
  const inspect = (identity: string, format: string) => docker(['inspect', '--format', format, identity]);
  await scope.test('a transferred derivative package imports its missing image and retains image-owned readiness', async child => {
    const original = fixture.current(), parent = inspect(fixture.containerName, '{{.Config.Image}}');
    assert.match(parent, /^sha256:[a-f0-9]{64}$/u);
    const metadata = JSON.parse(readFileSync(join(fixture.packages, original.name, 'release.json'), 'utf8')) as { migration: { reference: string } };
    const migrationImage = inspect(metadata.migration.reference, '{{.Id}}');
    const temporary = mkdtempSync(join(fixture.directory, 'transfer-'));
    let derivative: string | undefined;
    cleanup(child, () => rmSync(temporary, { recursive: true, force: true }));
    cleanup(child, () => {
      if (derivative && spawnSync('docker', ['image', 'inspect', derivative], { stdio: 'ignore' }).status === 0) docker(['image', 'rm', '--no-prune', derivative], artifactPreparationMilliseconds);
    });
    // Restore the original container before removing its derivative image or Compose file.
    cleanup(child, () => fixture.start(original));
    writeFileSync(join(temporary, 'Dockerfile'), 'FROM ' + parent + '\nLABEL org.crossfire.transfer=' + randomUUID() + '\n');
    derivative = docker(['build', '--quiet', '--cgroup-parent', process.env.CROSSFIRE_TEST_CGROUP_PARENT!, '--file', join(temporary, 'Dockerfile'), temporary], artifactPreparationMilliseconds);
    assert.match(derivative, /^sha256:[a-f0-9]{64}$/u);
    const output = join(temporary, 'package');
    const exported = spawnSync(process.execPath, [join(fixture.packages, original.name, 'package-tool.mjs'), 'export', '--runtime', derivative, '--migrations', migrationImage, '--output', output], { cwd: temporary, encoding: 'utf8', timeout: artifactPreparationMilliseconds });
    assert.equal(exported.status, 0, exported.stderr);
    docker(['image', 'rm', '--no-prune', derivative], artifactPreparationMilliseconds);
    assert.notEqual(spawnSync('docker', ['image', 'inspect', derivative], { stdio: 'ignore' }).status, 0, 'The receiving operator must actually load the archive');
    await fixture.close(); await fixture.start(original, output);
    assert.equal(inspect(fixture.containerName, '{{.Config.Image}}'), derivative); await fixture.operation(operations.currentSession);
    const verified = spawnSync(process.execPath, [join(output, 'package-tool.mjs'), 'verify', output], { cwd: temporary, encoding: 'utf8', timeout: artifactPreparationMilliseconds });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal((JSON.parse(verified.stdout) as { runtimeImage: string }).runtimeImage, derivative, 'The standalone package tool resolves no monorepo source');
    const health = JSON.parse(inspect(fixture.containerName, '{{json .Config.Healthcheck.Test}}')) as string[]; assert.equal(health[0], 'CMD'); docker(['exec', fixture.containerName, ...health.slice(1)]);
  });
  await scope.test('the same Compose kit runs every selected backend without data conversion', async child => {
    const original = fixture.current();
    for (const backend of fixture.targets) {
      await fixture.close(); await fixture.start(original, join(fixture.packages, backend.name));
      const manifest = JSON.parse(readFileSync(join(fixture.packages, backend.name, 'release.json'), 'utf8')) as { runtime: { reference: string } };
      assert.equal(inspect(fixture.containerName, '{{.Config.Image}}'), inspect(manifest.runtime.reference, '{{.Id}}'));
      await fixture.operation(operations.currentSession);
      const health = JSON.parse(inspect(fixture.containerName, '{{json .Config.Healthcheck.Test}}')) as string[];
      assert.equal(health[0], 'CMD'); docker(['exec', fixture.containerName, ...health.slice(1)]);
    }
    child.diagnostic(JSON.stringify({ configuration: original.name, backends: fixture.targets.map(backend => backend.name) }));
    await fixture.restart(original);
  });
  await scope.test('package validation fails before stopping the running Compose service', async () => {
    const temporary = mkdtempSync(join(fixture.directory, 'bad-package-'));
    try {
      for (const target of fixture.targets) for (const failure of ['archive', 'labels', 'schema']) {
        const path = join(temporary, target.name + '-' + failure); mkdirSync(path);
        const source = join(fixture.packages, target.name), manifest = JSON.parse(readFileSync(join(source, 'release.json'), 'utf8')) as Record<string, unknown>;
        if (failure === 'archive') writeFileSync(join(path, 'images.tar'), 'corrupt archive');
        else {
          copyFileSync(join(source, 'images.tar'), join(path, 'images.tar'));
          if (failure === 'labels') manifest.backend = 'incorrect-backend'; else manifest.schemaVersion = 1;
        }
        writeFileSync(join(path, 'release.json'), JSON.stringify(manifest));
        const identity = inspect(fixture.containerName, '{{.Id}}');
        await assert.rejects(fixture.start(target, path), failure === 'archive' ? /SHA-256/u : failure === 'labels' ? /release labels/u : /Invalid container package/u);
        assert.equal(inspect(fixture.containerName, '{{.Id}}'), identity);
        assert.equal(inspect(identity, '{{.State.Status}}'), 'running');
        await fixture.operation(operations.currentSession);
      }
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
  await scope.test('failed one-shot migration prevents activation and a fresh successful job restores the retained data', async () => {
    const override = join(fixture.directory, 'failed-migration.yaml');
    writeFileSync(override, 'services:\n  migrate:\n    entrypoint: [node, -e, "process.exit(23)"]\n    command: []\n');
    await fixture.close();
    const previous = await fixture.compose(['ps', '-a', '-q', 'migrate']); assert(previous);
    await fixture.compose(['rm', '-f', 'migrate']);
    await assert.rejects(fixture.compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '30'], override));
    assert.equal(await fixture.compose(['ps', '--status', 'running', '--services']), '');
    await fixture.start(fixture.current());
    const current = await fixture.compose(['ps', '-a', '-q', 'migrate']); assert(current); assert.notEqual(current, previous);
    assert.equal(inspect(current, '{{.State.ExitCode}}'), '0');
    await fixture.operation(operations.currentSession);
  });
  await scope.test('an independent Compose project cannot replace this project’s running containers', async () => {
    const identity = inspect(fixture.containerName, '{{.Id}}');
    const other = 'crossfire-isolation-' + randomUUID().slice(0, 8);
    assert.equal(docker(['ps', '-a', '--filter', 'label=com.docker.compose.project=' + other, '--format', '{{.ID}}']), '');
    const command = spawnSync('docker', ['compose', '--project-name', other, '-f', join(fixture.packages, fixture.current().name, 'compose.yaml'), 'down'],
      { encoding: 'utf8', timeout: 30000, env: { ...process.env, CROSSFIRE_RUNTIME_IMAGE: inspect(identity, '{{.Config.Image}}'), CROSSFIRE_MIGRATION_IMAGE: (JSON.parse(readFileSync(join(fixture.packages, fixture.current().name, 'release.json'), 'utf8')) as { migration: { reference: string } }).migration.reference } });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(inspect(fixture.containerName, '{{.Id}}'), identity);
    await fixture.operation(operations.currentSession);
  });
}
