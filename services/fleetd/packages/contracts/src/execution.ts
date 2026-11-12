import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { ExecutionCatalog, ExecutionPlacement, VmImage, VmMount, VmProfile } from '@ctlflow/fleetd-domain/execution';

const host = check.object({ kind: check.choice('host') });
const vm = check.object({ kind: check.choice('vm'), image: check.name, profile: check.name });
export function executionPlacement(input: unknown): Result<ExecutionPlacement> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('kind' in input)) return failure('invalid', 'Select host or VM execution');
  return input.kind === 'host' ? host(input) : vm(input);
}

export function validateExecution(placements: readonly ExecutionPlacement[], catalog: ExecutionCatalog | undefined): Result<null> {
  for (const placement of placements) {
    if (placement.kind === 'vm' && (!catalog || !Object.hasOwn(catalog.images, placement.image)
      || !Object.hasOwn(catalog.profiles, placement.profile)))
      return failure('invalid', 'VM execution must reference an image and profile in this fleet execution catalog');
  }
  return success(null);
}

const absolute = check.refine(check.text(4096), value => value.startsWith('/') && !value.includes('\\')
  && value.split('/').slice(1).every(segment => segment.length > 0 && segment !== '.' && segment !== '..'), 'Use an absolute normalized path');
const sha256 = check.refine(check.text(64, 64), value => /^[a-f0-9]{64}$/u.test(value), 'Use a lowercase SHA256 digest');
const image = check.object({ path: absolute, sha256 });
const mount = check.object({ path: absolute, read_only: check.boolean });
const profile = check.object({ cpus: check.integer(1, 64), memory_mib: check.integer(256, 1_048_576),
  maximum_memory_mib: check.integer(256, 1_048_576), network: check.choice('disabled', 'outbound'), mounts: check.list(mount, 100) });

function named<Value>(parse: check.Parser<Value>): check.Parser<Record<string, Value>> {
  return input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid', 'Expected named execution definitions');
    const entries = Object.entries(input);
    if (entries.length < 1 || entries.length > 100) return failure('invalid', 'Use 1–100 named execution definitions');
    const values: [string, Value][] = [];
    for (const [name, source] of entries) {
      const key = check.name(name); if (!key.ok) return key;
      const value = parse(source); if (!value.ok) return value;
      values.push([name, value.value]);
    }
    return success(Object.fromEntries(values));
  };
}

const catalog = check.object({ memory_budget_mib: check.integer(512, 1_048_576), host_reserve_mib: check.integer(256, 1_048_576),
  images: named(image), profiles: named(profile) });

export function executionCatalog(input: unknown): Result<ExecutionCatalog> {
  const parsed = catalog(input); if (!parsed.ok) return parsed;
  const value = parsed.value;
  const images: Record<string, VmImage> = value.images;
  const profiles: [string, VmProfile][] = [];
  for (const [name, source] of Object.entries(value.profiles)) {
    if (source.memory_mib > source.maximum_memory_mib || source.maximum_memory_mib > value.memory_budget_mib)
      return failure('invalid', 'VM target must fit its maximum and the controller memory budget');
    const paths = source.mounts.map(mount => mount.path);
    if (new Set(paths).size !== paths.length || paths.some(path => paths.some(other => other !== path && other.startsWith(path + '/'))))
      return failure('invalid', 'VM profile mounts cannot duplicate or overlap');
    const mounts: VmMount[] = source.mounts.map(mount => ({ path: mount.path, readOnly: mount.read_only }));
    profiles.push([name, { cpus: source.cpus, memoryMiB: source.memory_mib, maximumMemoryMiB: source.maximum_memory_mib,
      network: source.network, mounts }]);
  }
  return success({ memoryBudgetMiB: value.memory_budget_mib, hostReserveMiB: value.host_reserve_mib,
    images, profiles: Object.fromEntries(profiles) });
}
