import type { Json } from './json.js';
export const API = "/_matrix/client/v3";
export const segment = encodeURIComponent;

export function json(value: unknown, depth = 0): value is Json {
  if (depth > 64) return false;
  if (typeof value === "string") return value.isWellFormed();
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !(Array.isArray(value) && prototype === Array.prototype)) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, entry]) => key.isWellFormed() && "value" in entry && json(entry.value, depth + 1));
}
