import { useState, type SetStateAction } from 'react';
import { editableSnapshot, reconcileEditable, sameEditableValue } from './editable.js';

export function useEditable<Value, Version>(key: string, version: Version, initial: Value) {
  const source = editableSnapshot(key, version, initial);
  const [stored, setStored] = useState(source);
  const snapshot = reconcileEditable(stored, source);
  if (snapshot !== stored) setStored(snapshot);
  const conflict = !sameEditableValue(snapshot.version, version);
  function setValue(change: SetStateAction<Value>) {
    setStored(previous => {
      const current = reconcileEditable(previous, source);
      const value = typeof change === 'function' ? (change as (previous: Value) => Value)(current.value) : change;
      return { ...current, value };
    });
  }
  return { value: snapshot.value, version: snapshot.version, changed: !sameEditableValue(snapshot.value, snapshot.initial), conflict,
    setValue, reset: () => setStored(source) };
}

export function EditConflict({ conflict, reset }: { conflict: boolean; reset(): void }) {
  return conflict ? <div className="edit-conflict" role="alert"><p>These settings changed elsewhere. Your unsaved edits are kept, but cannot replace the newer settings.</p>
    <button type="button" onClick={reset}>Discard edits &amp; load latest</button></div> : null;
}
