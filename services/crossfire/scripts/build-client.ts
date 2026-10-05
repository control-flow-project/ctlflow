import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildAgentClient } from '@ctlflow/crossfire-agent-tools/build';

export async function buildClient(root: string, destination = join(root, 'dist/crossfire-client.mjs')): Promise<void> {
  await buildAgentClient(destination);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  if (!values.root) throw new Error('Supply the exact source --root directory');
  await buildClient(resolve(values.root));
  console.log('Built the controller-managed agent tools.');
}
