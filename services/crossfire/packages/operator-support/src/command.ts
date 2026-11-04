import { parseArgs } from 'node:util';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { readPrivateBytes, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import type { Parser } from '@ctlflow/crossfire-contracts/schema/validation';

export type Options = Readonly<Record<string, string | boolean | undefined>>;
export function options(arguments_: string[], required: string[], optional: string[] = [], flags: string[] = []): Result<Options> {
  try {
    const definitions: Record<string, { type: 'string' | 'boolean' }> = {};
    for (const name of [...required, ...optional]) definitions[name] = { type: 'string' };
    for (const name of flags) definitions[name] = { type: 'boolean' };
    const parsed = parseArgs({ args: arguments_, options: definitions, strict: true, allowPositionals: false, tokens: true });
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) return failure('invalid', 'Supply each option once: --' + token.name);
      seen.add(token.name);
    }
    for (const name of required) if (typeof parsed.values[name] !== 'string' || !parsed.values[name]) return failure('invalid', 'Required: --' + name);
    return success(parsed.values);
  } catch { return failure('invalid', 'Invalid command options; see the tools README'); }
}
export function textOption(values: Options, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}
export function inputFile<Value>(file: string, parse: Parser<Value>): Result<Value> {
  try { return parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readPrivateBytes(file, 2 * 1024 * 1024)))); }
  catch { return failure('invalid', 'Input must be valid JSON in a private, bounded, owned non-symlink file'); }
}
export function saveReport<Value>(result: Result<Value>, values: Options): Result<Value> {
  const output = textOption(values, 'output');
  if (result.ok && output) writeJson(output, result.value, 16 * 1024 * 1024);
  return result;
}
export async function runTool(work: (signal: AbortSignal) => Promise<Result<unknown>>): Promise<void> {
  process.umask(0o077);
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(300000)]);
  try {
    const result = await work(signal);
    if (!result.ok) { process.stderr.write(JSON.stringify({ error: result.error }) + '\n'); process.exitCode = 1; return; }
    process.stdout.write(JSON.stringify(result.value, null, 2) + '\n');
  } catch {
    process.stderr.write(JSON.stringify({ error: { code: 'unavailable', message: signal.aborted ? 'Operator check cancelled or timed out' : 'Operator check failed; no private response data is printed' } }) + '\n');
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}
