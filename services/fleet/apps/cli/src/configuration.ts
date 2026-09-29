import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import * as check from '@crossfire/contracts/schema/validation';
const schema = check.object({ localRoot: check.nullable(check.text(4096)), remotes: check.list(check.object({ name: check.name, ssh: check.text(255), root: check.text(4096) }), 100) });
export type Connections = check.Parsed<typeof schema>;
const path = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'fleet', 'connections.json');
export function loadConnections(): Connections {
  if (!existsSync(path())) return { localRoot: null, remotes: [] };
  const parsed = schema(readJson<unknown>(path()));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}
export function saveConnections(configuration: Connections): void {
  const parsed = schema(configuration);
  if (!parsed.ok) throw new Error(parsed.error.message);
  writeJson(path(), parsed.value);
}
