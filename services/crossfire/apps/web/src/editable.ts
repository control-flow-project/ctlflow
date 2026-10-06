export type EditableSnapshot<Value, Version> = { key: string; version: Version; initial: Value; value: Value };

export function editableSnapshot<Value, Version>(key: string, version: Version, value: Value): EditableSnapshot<Value, Version> {
  return { key, version, initial: value, value };
}

export function sameEditableValue<Value>(left: Value, right: Value): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function reconcileEditable<Value, Version>(current: EditableSnapshot<Value, Version>, source: EditableSnapshot<Value, Version>): EditableSnapshot<Value, Version> {
  if (current.key !== source.key) return source;
  if (sameEditableValue(current.version, source.version) || !sameEditableValue(current.value, current.initial)) return current;
  return source;
}
