import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyPrivateFiles } from './verify-private-files.mjs';

function fixture(scope, ignored = '.analysis/\n') {
  const root = mkdtempSync(join(tmpdir(), 'ctlflow-private-files-'));
  scope.after(() => rmSync(root, { recursive: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  writeFileSync(join(root, '.gitignore'), ignored);
  for (const directory of ['.analysis', 'nested/.analysis']) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, 'private-note'), 'private contents must not appear in diagnostics');
  }
  execFileSync('git', ['add', '.gitignore'], { cwd: root });
  return root;
}

test('repository checks preserve ignored local notes and allow ordinary tracked files', scope => {
  const root = fixture(scope);
  verifyPrivateFiles(root);
  assert.equal(readFileSync(join(root, '.analysis/private-note'), 'utf8'), 'private contents must not appear in diagnostics');
  assert.equal(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }), '.gitignore\n');
});

test('force-added root and nested analysis files are rejected without reading their contents', scope => {
  const root = fixture(scope);
  for (const file of ['.analysis/private-note', 'nested/.analysis/private-note']) {
    execFileSync('git', ['add', '--force', file], { cwd: root });
    assert.throws(() => verifyPrivateFiles(root), error => error instanceof Error && error.message.includes('must never be tracked') && !error.message.includes('private contents'));
    execFileSync('git', ['rm', '--cached', file], { cwd: root });
  }
  verifyPrivateFiles(root);
});

test('missing or root-only ignore rules cannot leave nested analysis eligible for tracking', scope => {
  for (const ignored of ['', '/.analysis/\n']) assert.throws(() => verifyPrivateFiles(fixture(scope, ignored)), /at every directory level/u);
});
