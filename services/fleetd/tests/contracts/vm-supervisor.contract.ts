import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { record, text, integer, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { vmFixture } from './vm-fixture.js';

// One assertion bank for all native targets. Missing prerequisites/image are
// a deliberate failure fixture, never successful guest certification.
export async function vmSupervisorContracts(scope: TestContext, selected: Pick<ContractTarget, 'name' | 'daemon'>): Promise<void> {
  const fixture = await vmFixture(selected);
  try {
    for (const action of ['close', 'kill', 'controller-kill'] as const) await scope.test('unavailable VM retains ownership until ' + action + ': ' + selected.name, async childScope => {
      const started = performance.now(), boot = fixture.boot();
      await boot.expect('failed');
      assert.deepEqual(Object.keys(boot.messages[0]!).sort(), ['id', 'state']);
      assert.deepEqual(Object.keys(boot.messages[1]!).sort(), ['error', 'id', 'state']);
      const failure = text(boot.messages[1]!.error);
      assert.match(failure, /^(The fleetd user service cannot open \/dev\/kvm|VM firmware is missing|Cannot read the private fleet VM image|VM image)/u,
        'Fixture failure must identify unavailable VM prerequisites/image');
      assert.throws(() => acquireFileLock(join(fixture.ownership, 'owner')), { code: 'ELOCKED' });
      const receipt = record(JSON.parse(readFileSync(join(fixture.ownership, 'vm-receipt.json'), 'utf8')) as unknown);
      assert.equal(receipt.id, boot.id); assert.equal(receipt.state, 'failed'); assert.equal(receipt.error, failure);
      assert(integer(receipt.endedAt) >= integer(receipt.startedAt));
      await boot.finish(action);
      const release = acquireFileLock(join(fixture.ownership, 'owner')); release();
      childScope.diagnostic(JSON.stringify({ target: selected.name, action, elapsedMs: Math.round(performance.now() - started),
        tested: 'failed-start ownership and service teardown', guestStarted: false, error: failure }));
    });
  } finally { await fixture.close(); }
}
