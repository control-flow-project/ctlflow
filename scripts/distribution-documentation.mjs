import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentationLinks } from './verify-documentation.mjs';

export const distributionGuides = Object.freeze({
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
}
