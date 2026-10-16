import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { config } from '../apps/server/src/config.js';

export function checkContainerConfiguration(arguments_: string[]): void {
  const { values, positionals } = parseArgs({ args: arguments_, allowPositionals: true, options: {
    directory: { type: 'string' }, instance: { type: 'string' }, origin: { type: 'string' },
    'content-origin': { type: 'string' }, 'server-name': { type: 'string' },
  } });
  if (positionals.length || !values.directory || !values.instance || !values.origin || !values['content-origin'] || !values['server-name'])
    throw new Error('Supply --directory, --instance, --origin, --content-origin and --server-name');
  const parsed = config(readJson(join(values.directory, 'config.json')));
  if (!parsed.ok) throw new Error(parsed.error.message);
  if (parsed.value.instance !== values.instance || parsed.value.publicOrigin !== values.origin || parsed.value.contentOrigin !== values['content-origin'] || parsed.value.serverName !== values['server-name'])
    throw new Error('Private configuration does not match the deployment identity and origins');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkContainerConfiguration(process.argv.slice(2));
  console.log('Private configuration validated; no files changed');
}
