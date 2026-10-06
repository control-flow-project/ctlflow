import assert from 'node:assert/strict';
import test from 'node:test';
import { editableSnapshot, reconcileEditable, sameEditableValue } from '../apps/web/src/editable.js';

test('editable snapshots refresh pristine values with their exact revision and generation', () => {
  const original = editableSnapshot('room', { revision: 1, generation: null as string | null }, { access: 'none', muted: false });
  const latest = editableSnapshot('room', { revision: 2, generation: 'replacement' }, { access: 'reply', muted: true });
  assert.equal(reconcileEditable(original, latest), latest);
  assert.equal(reconcileEditable(latest, editableSnapshot('room', { ...latest.version }, { ...latest.value })), latest);
  assert.equal(sameEditableValue(original.version, latest.version), false);
});

test('dirty input keeps its original authority fence until explicitly discarded or reverted', () => {
  const original = editableSnapshot('room', { revision: 1, generation: 'original' }, { access: 'reply', muted: false });
  const dirty = { ...original, value: { access: 'read', muted: true } };
  const latest = editableSnapshot('room', { revision: 2, generation: 'replacement' }, { access: 'custom', muted: false });
  assert.equal(reconcileEditable(dirty, latest), dirty);
  assert.equal(dirty.version.generation, 'original');
  assert.equal(reconcileEditable({ ...dirty, value: { ...original.initial } }, latest), latest);
  assert.equal(reconcileEditable(dirty, { ...latest, key: 'another-room' }).key, 'another-room');
});
