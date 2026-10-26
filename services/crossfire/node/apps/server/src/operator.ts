import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { privateDir, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { administratorUser, matrixConfiguration } from '@ctlflow/crossfire-adapter-matrix/config';
import { standalone } from './standalone.js';

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args[0] === 'serve') { await standalone(args.slice(1)); return; }
  const parsed = parseArgs({ args, allowPositionals: true, tokens: true, options: { directory: { type: 'string' }, instance: { type: 'string' },
    origin: { type: 'string' }, 'content-origin': { type: 'string' }, 'server-name': { type: 'string' }, administrator: { type: 'string' }, help: { type: 'boolean' } } });
  const seen = new Set<string>();
  for (const token of parsed.tokens) if (token.kind === 'option') {
    if (seen.has(token.name)) throw new Error('Duplicated option --' + token.name);
    seen.add(token.name);
  }
  const action = parsed.positionals[0];
  if (parsed.values.help || !action) { console.log('crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\nInitializes private configuration only. Use Docker Compose with the matching one-shot migration image for deployment.'); return; }
  if (parsed.positionals.length !== 1 || action !== 'init') throw new Error('Use init or serve; see --help');
  const allowed = ['directory', 'instance', 'origin', 'content-origin', 'server-name', 'administrator'];
  if (Object.keys(parsed.values).some(key => !allowed.includes(key))) throw new Error('Invalid option for init; see --help');
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 26) throw new Error('Linux and Node.js 26+ required');
  if (!parsed.values.directory) throw new Error('Supply an explicit --directory');
  const directory = resolve(parsed.values.directory);
  if (action === 'init') {
    if (existsSync(directory) && readdirSync(directory).length) throw new Error('Initialization requires an empty directory; existing data is never overwritten');
    const administrator = administratorUser(parsed.values.administrator, parsed.values['server-name']);
    if (!administrator.ok) throw new Error(administrator.error.message);
    const token = () => randomBytes(32).toString('base64url');
    const configuration = config({ instance: parsed.values.instance, publicOrigin: parsed.values.origin, contentOrigin: parsed.values['content-origin'],
      messaging: { type: 'matrix', parameters: { serverName: parsed.values['server-name'], origin: 'http://127.0.0.1:6167', jwtSecret: token(), registrationSecret: token() } },
      administrator: administrator.value });
    if (!configuration.ok) throw new Error(configuration.error.message);
    const backend = matrixConfiguration(configuration.value.messaging);
    if (!backend.ok) throw new Error(backend.error.message);
    privateDir(directory);
    writeJson(join(directory, 'config.json'), configuration.value);
    writeJson(join(directory, 'bootstrap.json'), { servicePassword: token(), administratorPassword: token() });
    console.log('Initialized ' + directory + '\nAdministrator: ' + configuration.value.administrator + '\nInitial password: administratorPassword in ' + join(directory, 'bootstrap.json'));
    return;
  }
}
