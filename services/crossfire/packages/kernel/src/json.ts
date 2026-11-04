export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function equalJson(left: Json, right: Json): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]!));
  if (Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key]!, right[key]!));
}

export function json(value: unknown, depth = 0): value is Json {
  if (depth > 64) return false;
  if (typeof value === 'string') return value.isWellFormed();
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !(Array.isArray(value) && prototype === Array.prototype)) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, entry]) => key.isWellFormed() && 'value' in entry && json(entry.value, depth + 1));
}
