import { failure } from '@ctlflow/crossfire-kernel/result';
import type { NativeInspector, NativePreserver } from './types.js';
import { inspectCodex, preserveCodex } from './codex.js';

const inspectors: Readonly<Record<string, NativeInspector>> = { codex: inspectCodex };
export const inspectNative: NativeInspector = (input, signal) => {
  const inspect = inspectors[input.attachment.runtime];
  return inspect ? inspect(input, signal) : Promise.resolve(failure('invalid', 'This build has no fleet inspection adapter for the selected native runtime'));
};
const preservers: Readonly<Record<string, NativePreserver>> = { codex: preserveCodex };
export function preserveNative(runtime: string, workspace: string) {
  const preserve = preservers[runtime];
  return preserve ? preserve(workspace) : failure('invalid', 'This build has no preservation adapter for the selected native runtime');
}
