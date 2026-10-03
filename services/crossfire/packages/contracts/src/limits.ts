export const DEFAULT_OUTPUT_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 96 * 1024;
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_MESSAGE_BYTES = 50_000;
export const DEFAULT_EVENTS = 20;
export const MAX_EVENTS = 100;

export function integerOption(value: string | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value !== undefined && !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be an integer ${minimum}..${maximum}`);
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${label} must be ${minimum}..${maximum}`);
  return result;
}

export function outputBytes(value: string | undefined): number {
  return integerOption(value, DEFAULT_OUTPUT_BYTES, 1024, MAX_OUTPUT_BYTES, '--max-output-bytes');
}

export function encodeOutput(value: unknown, maximum = DEFAULT_OUTPUT_BYTES): Buffer {
  if (!Number.isInteger(maximum) || maximum < 1024 || maximum > MAX_OUTPUT_BYTES) throw new Error('Invalid output byte limit');
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > maximum) throw new Error(`Output exceeds ${maximum} bytes; narrow the query, reduce its native limit, or use --output-file. No read position was advanced.`);
  return bytes;
}
