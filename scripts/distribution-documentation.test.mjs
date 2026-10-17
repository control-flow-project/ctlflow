import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { distributionGuides, stageDistributionDocumentation } from './distribution-documentation.mjs';
import { documentationLinks } from './verify-documentation.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const headings = ['Prerequisites', 'Build and package', 'Install and run the server', 'Install and connect fleet and fleetd', 'Upgrade and verify'];

test('every target has separate installation instructions; native publishers retain their exact canonical guides', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'crossfire-distribution-docs-'));
  try {
    for (const target of ['node', 'csharp-managed', 'csharp-nativeaot', 'rust']) {
      const filename = target + '.md';
      const expected = readFileSync(join(repository, 'docs/distributions', filename), 'utf8');
      for (const heading of headings) assert(expected.includes('\n## ' + heading + '\n'), target + ' documents ' + heading);
      for (const { target: link } of documentationLinks(expected)) assert(link.startsWith('https://') || link.startsWith('#'), target + ' is readable independently of a local source checkout');
      if (!Object.hasOwn(distributionGuides, target)) continue;
      const destination = join(temporary, target); mkdirSync(destination);
      stageDistributionDocumentation(repository, destination, target);
      assert.equal(readFileSync(join(destination, 'README.md'), 'utf8'), expected, target + ' ships the reviewed target-specific instructions');
    }
    assert.throws(() => stageDistributionDocumentation(repository, temporary, 'csharp'), /explicit native distribution/u);
    assert.throws(() => stageDistributionDocumentation(repository, temporary, 'node'), /explicit native distribution/u);
    assert.throws(() => stageDistributionDocumentation(repository, temporary, '__proto__'), /explicit native distribution/u);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('a repository-only link or malformed UTF-8 cannot enter a standalone guide', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'crossfire-distribution-links-'));
  try {
    const guides = join(temporary, 'docs/distributions'); mkdirSync(guides, { recursive: true });
    const source = join(guides, 'rust.md');
    for (const link of ['../../../docs/development.md', '/manage/', 'file:///private/source', 'http://example.test/']) {
      writeFileSync(source, '[Repository-only or insecure link](' + link + ')');
      assert.throws(() => stageDistributionDocumentation(temporary, temporary, 'rust'), /must not require the source checkout/u);
    }
    writeFileSync(source, Buffer.from([0xc3, 0x28]));
    assert.throws(() => stageDistributionDocumentation(temporary, temporary, 'rust'), TypeError);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
