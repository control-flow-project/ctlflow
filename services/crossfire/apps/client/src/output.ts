import { writeSync } from 'node:fs';
import { encodeOutput } from '@ctlflow/crossfire-contracts/limits';
export function emit(value: unknown, maximum?: number): void {
  const bytes = encodeOutput(value, maximum);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset);
}
export function emitText(value: string, maximum: number): void {
  const bytes = Buffer.from(value + '\n');
  if (bytes.length > maximum) throw new Error('History output exceeds the selected tool-output bound; no unread position was advanced');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset);
}
