import assert from 'node:assert/strict';
import test from 'node:test';
import { validateContractMatrix } from './contract-targets.mjs';

const command = { binary: process.execPath, arguments: [] };
const node = { name: 'node', implementation: 'node', server: command, daemon: command, cli: command };
const managed = { ...node, name: 'csharp-managed', implementation: 'csharp' };
const native = { ...managed, name: 'csharp-nativeaot' };

test('one explicit matrix validates all executable and container workers without target skips', () => {
  assert.deepEqual(validateContractMatrix({ schemaVersion: 1, targets: [node, managed, native] }), [node, managed, native]);
  assert.deepEqual(validateContractMatrix({ schemaVersion: 1, targets: [node] }), [node]);
  for (const targets of [[], [managed, native], [node, managed], [node, native], [node, node], [{ ...node, skip: true }], [{ ...node, server: { binary: 'relative', arguments: [] } }], [{ ...node, cli: { ...command, arguments: ['invalid\0'] } }], [{ ...node, implementation: 'unknown' }]]) assert.throws(() => validateContractMatrix({ schemaVersion: 1, targets }));
  assert.throws(() => validateContractMatrix({ schemaVersion: 1, targets: [node], fallback: true }));
});
