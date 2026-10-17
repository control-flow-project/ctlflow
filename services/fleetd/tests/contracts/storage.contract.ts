import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { contractProcess, observe, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';

export async function storageContracts(scope: TestContext, selected: ContractTarget, directory: string, environment: NodeJS.ProcessEnv): Promise<void> {
  for (const name of ['operations.json', 'daemon.log']) {
    await scope.test('startup rejects obsolete ' + name + ' without importing or deleting it', async child => {
      const root = join(directory, name === 'operations.json' ? 'old-operations' : 'old-diagnostics');
      mkdirSync(root, { mode: 0o700 });
      const bytes = Buffer.from('not a supported state format');
      writeFileSync(join(root, name), bytes, { mode: 0o600 });
      const daemon = contractProcess(child, selected.daemon, ['--root', root], directory, environment);
      await observe(() => !daemon.alive(), 'Unsupported state must fail startup rather than start or convert', 30000);
      assert.notEqual(await daemon.ended, 0);
      assert.match(daemon.errors(), /Unsupported controller state/u);
      assert.deepEqual(readFileSync(join(root, name)), bytes);
      assert(!readdirSync(root).includes('fleetd.sock'), 'No ready socket is published');
      assert(!readdirSync(root).includes('operations'), 'No imported operation directory is published');
    });
  }
}
