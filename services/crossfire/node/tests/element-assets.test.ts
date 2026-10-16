import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { elementAssets, prepareElementAssets } from './support/element.js';

const identity = 'a'.repeat(64);
function fixture(operation: (directory: string) => void): void {
  const previous = process.cwd(), root = mkdtempSync(join(tmpdir(), 'element-assets-'));
  try {
    mkdirSync(join(root, 'node')); writeFileSync(join(root, 'node/Dockerfile'), 'FROM vectorim/element-web:pinned-fixture AS element\n');
    process.chdir(root); operation(root);
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
}

test('Element extraction owns the exact container and reserves the finite cleanup deadline before declaring readiness', () => fixture(root => {
  const calls: [string[], number][] = [];
  prepareElementAssets((arguments_, timeout) => {
    calls.push([arguments_, timeout]);
    if (arguments_[0] === 'cp') writeFileSync(join(arguments_[2]!, 'index.html'), '<!doctype html>');
    return identity + '\n';
  });
  assert.deepEqual(calls, [
    [['create', 'vectorim/element-web:pinned-fixture'], 60000],
    [['cp', identity + ':/app/.', join(root, 'dist/test-assets/element')], 60000],
    [['rm', identity], 120000],
  ]);
  assert.equal(elementAssets(), join(root, 'dist/test-assets/element'));
}));

test('Element extraction preserves its primary failure while still completing owned cleanup', () => fixture(root => {
  const primary = new Error('copy failed'); let cleaned = false;
  assert.throws(() => prepareElementAssets(arguments_ => {
    if (arguments_[0] === 'cp') throw primary;
    if (arguments_[0] === 'rm') cleaned = true;
    return identity;
  }), error => error === primary);
  assert.equal(cleaned, true); assert.equal(existsSync(join(root, 'dist/test-assets/element-image')), false);
}));

test('Element cleanup failures remain failures and cannot hide extraction failures or create a ready marker', () => {
  for (const failCopy of [false, true]) fixture(root => {
    const primary = new Error('copy failed'), cleanup = new Error('cleanup failed');
    assert.throws(() => prepareElementAssets(arguments_ => {
      if (failCopy && arguments_[0] === 'cp') throw primary;
      if (arguments_[0] === 'rm') throw cleanup;
      return identity;
    }), error => failCopy ? error instanceof AggregateError && error.errors.length === 2 && error.errors[0] === primary && error.errors[1] === cleanup : error === cleanup);
    assert.equal(existsSync(join(root, 'dist/test-assets/element-image')), false);
  });
});

test('Element extraction never copies or removes a guessed container identity', () => fixture(() => {
  let calls = 0;
  assert.throws(() => prepareElementAssets(() => { calls++; return 'not-an-exact-id'; }), /invalid Element fixture identity/u);
  assert.equal(calls, 1);
}));
