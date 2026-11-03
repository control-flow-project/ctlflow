import assert from 'node:assert/strict';
import test from 'node:test';
import { validateContractMatrix } from './contract-targets.mjs';

const command = { binary: process.execPath, arguments: [] };
const base = { server: command, daemon: command, cli: command };
const managed = { ...base, name: 'csharp-managed', implementation: 'csharp' };
const native = { ...managed, name: 'csharp-nativeaot' };
const rust = { ...base, name: 'rust', implementation: 'rust' };
test('native matrices reject removed Node services and never skip configured implementations', () => {
  assert.deepEqual(validateContractMatrix({ schemaVersion: 1, targets: [managed, native, rust] }), [managed, native, rust]);
  assert.deepEqual(validateContractMatrix({ schemaVersion: 1, targets: [rust] }), [rust]);
  for (const targets of [[], [managed], [native], [rust, rust], [{ ...rust, implementation: 'node' }], [{ ...rust, skip: true }], [{ ...rust, server: { binary: 'relative', arguments: [] } }], [{ ...rust, cli: { ...command, arguments: ['invalid\0'] } }], [{ ...rust, implementation: 'unknown' }]]) assert.throws(() => validateContractMatrix({ schemaVersion: 1, targets }));
  assert.throws(() => validateContractMatrix({ schemaVersion: 1, targets: [rust], fallback: true }));
});
