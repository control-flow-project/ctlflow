import { writeSync } from 'node:fs';
import { encodeOutput } from '@crossfire/contracts/limits';
export function emit(value: unknown, maximum?: number): void {
  const bytes = encodeOutput(value, maximum);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset);
}
