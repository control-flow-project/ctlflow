import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentationLinks } from './verify-documentation.mjs';

export const distributionGuides = Object.freeze({
  'csharp-managed': 'csharp-managed.md',
  'csharp-nativeaot': 'csharp-nativeaot.md',
  rust: 'rust.md',
});

export function stageDistributionDocumentation(repository, destination, target) {
  if (!Object.hasOwn(distributionGuides, target)) throw new Error('Select an explicit native distribution documentation target');
  const source = join(repository, 'docs/distributions', distributionGuides[target]);
  const guide = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(source));
  for (const { target: link } of documentationLinks(guide)) {
    if (!link.startsWith('https://') && !link.startsWith('#')) throw new Error('Installed distribution guide links must not require the source checkout: ' + link);
  }
  copyFileSync(source, join(destination, 'README.md'));
  const vm = join(destination, 'vm'); mkdirSync(vm, { mode: 0o755 });
  copyFileSync(join(repository, 'docs/architecture/vm-execution.md'), join(vm, 'README.md'));
  copyFileSync(join(repository, 'services/fleetd/scripts/setup-vm-host.sh'), join(vm, 'setup-vm-host.sh'));
  copyFileSync(join(repository, 'services/fleetd/images/qemu/fleet.pkr.hcl'), join(vm, 'fleet.pkr.hcl'));
}
