import { failure, success, type Result } from '@crossfire/kernel/result';
import * as check from './schema/validation.js';
export function object(value: unknown): Result<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? success(value as Record<string, unknown>) : failure('invalid', 'Expected an object');
}
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Result<Record<string, unknown>> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  if (required.some(key => !Object.hasOwn(parsed.value, key)) || Object.keys(parsed.value).some(key => !required.includes(key) && !optional.includes(key))) {
    return failure('invalid', 'Missing or unknown fields');
  }
  return parsed;
}
export function text(value: unknown, maximum = 200): value is string { return check.text(maximum)(value).ok; }
export function userId(value: unknown): value is string { return check.matrixUserId(value).ok; }
export function roomId(value: unknown): value is string { return check.roomId(value).ok; }
export function selectRoom(selector: string): string {
  if (!roomId(selector)) throw new Error('Use an exact native room ID from matrix get-joined-rooms');
  return selector;
}
