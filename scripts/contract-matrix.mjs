import { accessSync, constants, existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { repository } from './build.mjs';

const { values, positionals } = parseArgs({ options: { managed: { type: 'string' }, nativeaot: { type: 'string' }, rust: { type: 'string' }, output: { type: 'string' } }, allowPositionals: true });
if (positionals.length || ['managed', 'nativeaot', 'output'].some(key => !values[key] || !isAbsolute(values[key])) || values.rust !== undefined && !isAbsolute(values.rust)) throw new Error('Supply absolute --managed and --nativeaot distribution directories, optional --rust distribution, and a new --output JSON file');
if (existsSync(values.output)) throw new Error('Contract matrix output already exists');
const command = (binary, arguments_ = []) => ({ binary, arguments: arguments_ });
const targets = [{ name: 'node', implementation: 'node', server: command(process.execPath, [join(repository, 'services/crossfire/crossfire')]), daemon: command(process.execPath, [join(repository, 'services/fleetd/dist/apps/daemon/src/main.js')]), cli: command(process.execPath, [join(repository, 'services/fleet/dist/apps/cli/src/main.js')]) }];
const native = [['csharp-managed', 'csharp', values.managed, 'Crossfire.Server'], ['csharp-nativeaot', 'csharp', values.nativeaot, 'Crossfire.Server']]; if (values.rust !== undefined) native.push(['rust', 'rust', values.rust, 'crossfire']);
for (const [name, implementation, directory, server] of native) {
  const root = resolve(directory), target = { name, implementation, server: command(join(root, 'crossfire', server)), daemon: command(join(root, 'fleetd/fleetd')), cli: command(join(root, 'fleet/fleet')) };
  for (const product of ['server', 'daemon', 'cli']) accessSync(target[product].binary, constants.X_OK);
  targets.push(target);
}
writeFileSync(values.output, JSON.stringify({ schemaVersion: 1, targets }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(resolve(values.output));
