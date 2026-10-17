import { join } from 'node:path';
import { currentConfigurationRoot } from '@ctlflow/fleetd-storage/authentication';
import { existsSync } from 'node:fs';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
const schema = check.object({ localRoot: check.nullable(check.text(4096)), remotes: check.list(check.object({ name: check.name, ssh: check.text(255), root: check.text(4096) }), 100) });
export type Connections = check.Parsed<typeof schema>;
const path = () => join(currentConfigurationRoot(), 'fleet', 'connections.json');
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
