import { parse } from 'smol-toml';
import * as check from '@crossfire/contracts/schema/validation';
import { failure, success, type Result } from '@crossfire/kernel/result';

export const instance = check.object({ key: check.name, name: check.name, definition: check.name, workarea: check.text(1024) });
export const coordination = check.object({ adapter: check.choice('crossfire'), server: check.text(2048), owner: check.matrixUserId, approval_room: check.optional(check.roomId) });
export const roster = check.object({ fleet: check.name, coordination, instances: check.list(instance, 100) });
export const definition = check.object({ name: check.text(100), runtime: check.name, runtime_options: (input: unknown): Result<Record<string, unknown>> =>
  input && typeof input === 'object' && !Array.isArray(input) ? success(input as Record<string, unknown>) : failure('invalid', 'Expected runtime options') });
export type Instance = check.Parsed<typeof instance>;
export type Roster = check.Parsed<typeof roster>;
export type Definition = check.Parsed<typeof definition>;
export function parseToml<Value>(source: string, parser: check.Parser<Value>): Result<Value> {
  if (Buffer.byteLength(source) > 1024 * 1024) return failure('limit', 'TOML exceeds 1 MiB');
  try { return parser(parse(source, { integersAsBigInt: 'asNeeded' })); }
  catch { return failure('invalid', 'Invalid TOML'); }
}
export function relativePath(value: string): boolean {
  return value.length > 0 && !value.startsWith('/') && !value.includes('\\') && value.split('/').every(segment => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.'));
}
export function validateRoster(input: unknown): Result<Roster> {
  const result = roster(input);
  if (!result.ok) return result;
  const value = result.value;
  for (const key of ['key', 'name', 'workarea'] as const) if (new Set(value.instances.map(instance => instance[key])).size !== value.instances.length) return failure('invalid', 'Duplicate instance ' + key);
  for (const current of value.instances) {
    const segments = current.workarea.split('/');
    if (!relativePath(current.workarea) || segments[0] !== 'agents' || !check.name(segments[1]).ok || segments[2] !== 'workarea' || segments.length < 4) return failure('invalid', 'Work areas must be relative children of agents/<definition>/workarea');
    if (value.instances.some(other => other !== current && other.workarea.startsWith(current.workarea + '/'))) return failure('invalid', 'Instance work areas cannot overlap');
  }
  let server: URL;
  try { server = new URL(value.coordination.server); } catch { return failure('invalid', 'Invalid Crossfire origin'); }
  if (server.pathname !== '/' || server.username || server.password || server.search || server.hash ||
    server.protocol !== 'https:' && !(server.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname))) return failure('invalid', 'Use an HTTPS origin or loopback HTTP');
  return success(value);
}
