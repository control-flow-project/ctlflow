import assert from 'node:assert/strict';
import test from 'node:test';
import filesystem, { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { retainResumptionInput, resumptionText } from '@ctlflow/crossfire-adapter-runtime/resumption';

test('restart context is flushed before its file and parent directory references are retained', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-resumption-files-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const flushed: { device: number; inode: number }[] = [], synchronize = filesystem.fsyncSync;
  scope.mock.method(filesystem, 'fsyncSync', (descriptor: number) => {
    const information = filesystem.fstatSync(descriptor);
    flushed.push({ device: information.dev, inode: information.ino });
    synchronize(descriptor);
  });
  syncBuiltinESMExports();
  cleanup(scope, () => { scope.mock.restoreAll(); syncBuiltinESMExports(); });
  const input = { messageId: 'original', text: 'Room !source:test, @human:test, original message.' };
  const file = retainResumptionInput(input, join(directory, 'receipt.json'));
  assert.equal(readFileSync(file, 'utf8'), input.text);
  assert.equal(flushed.length, 3);
  assert.deepEqual(flushed, [file, join(directory, 'resume-input'), directory].map(path => {
    const information = filesystem.statSync(path);
    return { device: information.dev, inode: information.ino };
  }));
  assert.equal(filesystem.statSync(file).mode & 0o777, 0o600);
});

test('failed restart-file flush cannot expose partial context and a new attempt recreates the exact input', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-resumption-files-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const input = { messageId: 'original', text: 'Exact original message.' };
  const synchronize = scope.mock.method(filesystem, 'fsyncSync', () => { throw new Error('Controlled flush failure'); });
  syncBuiltinESMExports();
  cleanup(scope, () => { scope.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => resumptionText(input, join(directory, 'receipt.json'), directory), /Controlled flush failure/);
  assert.deepEqual(readdirSync(join(directory, 'resume-input')), []);
  synchronize.mock.restore(); syncBuiltinESMExports();
  const file = retainResumptionInput(input, join(directory, 'receipt.json'));
  assert.equal(readFileSync(file, 'utf8'), input.text);
});

for (const invalid of ['changed', 'symlink', 'public'] as const) test('restart context rejects ' + invalid + ' retained files without replacing evidence', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-resumption-files-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const input = { messageId: 'original', text: 'Exact original message.' }, receipt = join(directory, 'receipt.json');
  const file = retainResumptionInput(input, receipt);
  if (invalid === 'changed') writeFileSync(file, 'Changed input.');
  if (invalid === 'public') chmodSync(file, 0o644);
  if (invalid === 'symlink') {
    const target = join(directory, 'unrelated');
    writeFileSync(target, input.text, { mode: 0o600 }); rmSync(file); symlinkSync(target, file);
  }
  const before = readFileSync(file, 'utf8');
  assert.throws(() => retainResumptionInput(input, receipt), /Saved restart input differs/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
