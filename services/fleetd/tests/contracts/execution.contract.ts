import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { executionCatalog, executionPlacement } from '@ctlflow/fleetd-contracts/execution';

type Case = { name: string; kind: 'placement' | 'catalog'; valid: boolean; value: unknown };
const cases = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/contracts/execution-cases.json'), 'utf8')) as Case[];
for (const sample of cases) {
  test('execution contract: ' + sample.name, () => {
    const parsed = sample.kind === 'placement' ? executionPlacement(sample.value) : executionCatalog(sample.value);
    assert.equal(parsed.ok, sample.valid, sample.name);
    if (!parsed.ok) assert.equal(parsed.error.code, 'invalid');
  });
}

test('VM image, profile, units and mount access remain exact', () => {
  const parsed = executionCatalog({ memory_budget_mib: 4096, host_reserve_mib: 1024,
    images: { python: { path: '/srv/images/python.qcow2', sha256: 'a'.repeat(64) } },
    profiles: { research: { cpus: 2, memory_mib: 512, maximum_memory_mib: 2048,
      network: 'outbound', mounts: [{ path: '/srv/data', read_only: true }] } } });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.memoryBudgetMiB, 4096);
  assert.equal(parsed.value.hostReserveMiB, 1024);
  assert.equal(parsed.value.images.python?.sha256, 'a'.repeat(64));
  assert.deepEqual(parsed.value.profiles.research, { cpus: 2, memoryMiB: 512, maximumMemoryMiB: 2048,
    network: 'outbound', mounts: [{ path: '/srv/data', readOnly: true }] });
});
