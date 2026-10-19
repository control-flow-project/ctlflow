import { json, type JsonObject } from '@ctlflow/crossfire-kernel/json';

function parameters(value: unknown): JsonObject {
  if (!json(value) || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length > 64 || Buffer.byteLength(JSON.stringify(value)) > 8192) throw new Error('Backend access parameters are invalid');
  return value;
}

export function readNativeAccess(value: string | null): JsonObject | null {
  if (value === null) return null;
  return parameters(JSON.parse(value));
}

export function writeNativeAccess(value: JsonObject | null): string | null {
  if (value === null) return null;
  return JSON.stringify(parameters(value));
}
