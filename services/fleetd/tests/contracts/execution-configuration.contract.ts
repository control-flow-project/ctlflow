import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { stringify } from 'smol-toml';
import { validateRoster } from '@ctlflow/fleetd-contracts/configuration';
import { executionCatalog, validateExecution } from '@ctlflow/fleetd-contracts/execution';
import { loadConfiguration } from '@ctlflow/fleetd-storage/configuration';

type Case = { name: string; roster: Record<string, unknown>; catalog: Record<string, unknown> | null; valid: boolean };
const cases = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/contracts/execution-selection-cases.json'), 'utf8')) as Case[];
for (const sample of cases) {
  test('fleet execution configuration: ' + sample.name, () => {
    const roster = validateRoster(sample.roster);
    const catalog = sample.catalog ? executionCatalog(sample.catalog) : undefined;
    const valid = roster.ok && (catalog === undefined || catalog.ok)
      && validateExecution(roster.value.instances.map(instance => instance.execution ?? { kind: 'host' }), catalog?.value).ok;
    assert.equal(valid, sample.valid, sample.name);
  });
}

test('real fleet input loading retains execution, hashes its catalog and rejects missing references', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-vm-configuration-'));
  try {
    const sample = cases.find(sample => sample.name === 'fleet-approved VM');
    assert.ok(sample?.catalog);
    const role = join(directory, 'agents', 'research');
    mkdirSync(role, { recursive: true, mode: 0o755 });
    writeFileSync(join(role, 'agent.toml'), 'name="Research"\nruntime="codex"\n[runtime_options]\n', { mode: 0o600 });
    writeFileSync(join(role, 'AGENTS.md'), 'Fixture instructions.', { mode: 0o600 });
    writeFileSync(join(directory, 'runtime.toml'), stringify(sample.roster), { mode: 0o600 });
    const rejected = loadConfiguration(directory);
    assert.equal(rejected.ok, false, 'Never execute an unapproved VM on the host');
    writeFileSync(join(directory, 'execution.toml'), stringify(sample.catalog), { mode: 0o600 });
    const first = loadConfiguration(directory);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.value.roster.instances[0]?.execution, { kind: 'vm', image: 'python', profile: 'research' });
    assert.equal(first.value.execution?.profiles.research?.memoryMiB, 512);
    writeFileSync(join(directory, 'execution.toml'), stringify({ ...sample.catalog, host_reserve_mib: 1536 }));
    const changed = loadConfiguration(directory);
    assert.equal(changed.ok, true);
    if (changed.ok) assert.notEqual(changed.value.digest, first.value.digest, 'Catalog edits invalidate the old fleet revision');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
