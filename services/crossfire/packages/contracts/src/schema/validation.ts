import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
export type Parser<T> = (input: unknown) => Result<T>;
export type Parsed<Check> = Check extends Parser<infer Value> ? Value : never;
export function refine<Value>(parse: Parser<Value>, accepts: (value: Value) => boolean, message: string): Parser<Value> {
  return input => { const parsed = parse(input); return !parsed.ok || accepts(parsed.value) ? parsed : failure('invalid', message); };
}
export function text(maximum = 255, minimum = 1): Parser<string> {
  return input => typeof input === 'string' && input.length >= minimum && input.length <= maximum && input.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(input)
    ? success(input) : failure('invalid', 'Expected text of ' + minimum + '–' + maximum + ' characters');
}
export function integer(minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Parser<number> {
  return input => typeof input === 'number' && Number.isSafeInteger(input) && input >= minimum && input <= maximum ? success(input) : failure('invalid', 'Expected a bounded integer');
}
export const boolean: Parser<boolean> = input => typeof input === 'boolean' ? success(input) : failure('invalid', 'Expected a boolean');
export function choice<const Values extends readonly string[]>(...values: Values): Parser<Values[number]> {
  return input => typeof input === 'string' && values.includes(input) ? success(input) : failure('invalid', 'Choose one of: ' + values.join(', '));
}
export function nullable<Value>(parse: Parser<Value>): Parser<Value | null> { return input => input === null ? success(null) : parse(input); }
export function optional<Value>(parse: Parser<Value>): Parser<Value | undefined> { return input => input === undefined ? success(undefined) : parse(input); }
export function list<Value>(parse: Parser<Value>, maximum = 100, minimum = 0): Parser<Value[]> {
  return input => {
    if (!Array.isArray(input) || input.length < minimum || input.length > maximum) return failure('invalid', 'Expected a bounded list');
    const values: Value[] = [];
    for (const item of input) { const result = parse(item); if (!result.ok) return result; values.push(result.value); }
    return success(values);
  };
}
type Shape = Record<string, Parser<unknown>>;
type OptionalKeys<Fields extends Shape> = { [Key in keyof Fields]: undefined extends Parsed<Fields[Key]> ? Key : never }[keyof Fields];
type ObjectValue<Fields extends Shape> = { [Key in Exclude<keyof Fields, OptionalKeys<Fields>>]: Parsed<Fields[Key]> }
  & { [Key in OptionalKeys<Fields>]?: Exclude<Parsed<Fields[Key]>, undefined> };
export function object<const Fields extends Shape>(fields: Fields): Parser<ObjectValue<Fields>> {
  return input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid', 'Expected an object');
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some(key => !Object.hasOwn(fields, key))) return failure('invalid', 'Unknown request fields');
    const output: Record<string, unknown> = {};
    for (const [key, parse] of Object.entries(fields)) {
      const parsed = parse(record[key]);
      if (!parsed.ok) return { ok: false, error: { code: parsed.error.code, message: key + ': ' + parsed.error.message, fieldErrors: { [key]: parsed.error.message } } };
      if (parsed.value !== undefined) output[key] = parsed.value;
    }
    return success(output as ObjectValue<Fields>);
  };
}
export const identifier: Parser<string> = input => typeof input === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(input)
  ? success(input) : failure('invalid', 'Expected an opaque UUID');
export const name: Parser<string> = input => typeof input === 'string' && /^[a-z][a-z0-9-]{0,39}$/u.test(input) ? success(input) : failure('invalid', 'Expected a lowercase name of 1–40 characters');
export const matrixUserId: Parser<string> = input => typeof input === 'string' && input.length <= 255 && input.isWellFormed() && /^@[^:\s]+:[^\s]+$/u.test(input) ? success(input) : failure('invalid', 'Expected a Matrix user ID');
export const roomId: Parser<string> = input => typeof input === 'string' && input.length <= 255 && input.isWellFormed() && /^!\S+$/u.test(input) ? success(input) : failure('invalid', 'Expected an immutable Matrix room ID');
export const eventId: Parser<string> = input => typeof input === 'string' && input.length <= 255 && input.isWellFormed() && /^\$\S+$/u.test(input) ? success(input) : failure('invalid', 'Expected a Matrix event ID');
export const secret: Parser<string> = input => typeof input === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(input) ? success(input) : failure('invalid', 'Expected a private 32-byte claim');
export const empty = object({});
export const status = choice('active', 'suspended', 'revoked');
export const wakeMode = choice('selected', 'humans', 'everyone');
export function plainText(maximumBytes: number): Parser<string> {
  return input => typeof input === 'string' && input.isWellFormed() && new TextEncoder().encode(input).length <= maximumBytes && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input)
    ? success(input) : failure('invalid', 'Expected plain text up to ' + maximumBytes + ' UTF-8 bytes');
}
export const multiline = plainText(8192);
