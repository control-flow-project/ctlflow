import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { documentationLanguage, documentationLinks, verifyDocumentation } from './verify-documentation.mjs';

test('current guide links reject missing and escaping targets without treating code or historical records as guides', () => {
  const root = mkdtempSync(join(tmpdir(), 'crossfire-doc-links-'));
  try {
    mkdirSync(join(root, 'docs/verification'), { recursive: true }); mkdirSync(join(root, 'docs/plans')); mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, 't/native-home/.tmp/plugins'), { recursive: true });
    writeFileSync(join(root, 't/native-home/.tmp/plugins/README.md'), '[Third-party fixture](missing-upstream-path.md)');
    writeFileSync(join(root, 'README.md'), '[Guide](docs/guide.md#heading)\n[External](https://example.test/)\n```md\n[Example](missing.md)\n```\n');
    writeFileSync(join(root, 'docs/guide.md'), '# Heading\n[Root](../README.md)\n');
    writeFileSync(join(root, 'docs/verification/20261015-history.md'), '[Old path](no-longer-present.md)');
    writeFileSync(join(root, 'docs/plans/old.md'), '[Old path](absent.md)'); writeFileSync(join(root, 'node_modules/README.md'), '[Dependency](absent.md)');
    assert.equal(verifyDocumentation(root).files, 2);
    writeFileSync(join(root, 'docs/guide.md'), '[Missing](missing.md)'); assert.throws(() => verifyDocumentation(root), /docs\/guide.md:1: missing repository target/u);
    writeFileSync(join(root, 'docs/guide.md'), '[Escape](../../outside.md)'); assert.throws(() => verifyDocumentation(root), /missing repository target/u);
    writeFileSync(join(root, 'docs/guide.md'), '[Encoding](%zz.md)'); assert.throws(() => verifyDocumentation(root), /invalid URL encoding/u);
    assert.deepEqual(documentationLinks('~~~md\n[Example](none.md)\n~~~\n[Actual](README.md)'), [{ target: 'README.md', line: 4 }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('current authored guides reject promotional claims without rewriting policy or historical records', () => {
  const root = mkdtempSync(join(tmpdir(), 'crossfire-doc-language-'));
  try {
    mkdirSync(join(root, 'docs/verification'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'User policy: enterprise-grade review.');
    writeFileSync(join(root, 'docs/verification/20261015-history.md'), 'Old claim: production-ready.');
    writeFileSync(join(root, 'README.md'), '# Installation\nUses a private Unix socket.\n');
    assert.equal(verifyDocumentation(root).files, 2);
    for (const claim of ['Seamless setup', 'Blazingly fast', 'world-class', 'Enterprise-grade', 'production-ready', 'state-of-the-art']) {
      writeFileSync(join(root, 'README.md'), '# Guide\n' + claim);
      assert.throws(() => verifyDocumentation(root), /README.md:2: promotional wording/u);
    }
    assert.deepEqual(documentationLanguage('```text\nseamless\n```\nActual installation instructions.'), []);
    assert.deepEqual(documentationLanguage('No provider billing measurement is available. NativeAOT diagnostics remain visible.'), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
