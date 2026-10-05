import { parseArgs } from 'node:util';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { config } from './config.js';
import { privateDir, readJson, writeJson } from '@crossfire/adapter-filesystem/index';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const repository = resolve(root, '../..');
export function imageName(source: string): string {
  const hash = createHash('sha256');
  function add(path: string): void {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (['node_modules', 'dist', '.temp', '.analysis'].includes(item.name)) continue;
      const file = join(path, item.name);
      if (item.isDirectory()) add(file);
      else if (item.isFile()) hash.update(relative(source, file)).update(readFileSync(file));
      else throw new Error('Build input cannot be a symlink');
    }
  }
  for (const file of ['.dockerignore', '.npmrc', 'package.json', 'package-lock.json', 'tsconfig.base.json']) hash.update(file).update(readFileSync(join(source, file)));
  for (const directory of ['services', 'scripts']) add(join(source, directory));
  return 'crossfire-runtime:' + hash.digest('hex').slice(0, 20);
}
async function command(args: string[]): Promise<void> {
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolveCommand() : reject(new Error('Docker command failed')));
  });
}
export function runArguments(directory: string, image: string, port: number, contentPort: number): string[] {
  const name = 'crossfire-' + createHash('sha256').update(directory).digest('hex').slice(0, 16);
  return ['run', '--rm', '--name', name, '--label', 'org.crossfire.directory=' + directory,
    '--publish', '127.0.0.1:' + port + ':8080', '--publish', '127.0.0.1:' + contentPort + ':8082', '--mount', 'type=bind,"source=' + directory.replaceAll('"', '""') + '",target=/runtime',
    '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', image];
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({ args, allowPositionals: true, options: { directory: { type: 'string' }, instance: { type: 'string' },
    origin: { type: 'string' }, 'content-origin': { type: 'string' }, 'server-name': { type: 'string' }, administrator: { type: 'string' }, port: { type: 'string' }, 'content-port': { type: 'string' },
    compile: { type: 'boolean' }, help: { type: 'boolean' } } });
  const action = parsed.positionals[0];
  if (parsed.values.help || !action) { console.log('crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\ncrossfire start --directory DIR [--port PORT] [--content-port PORT] [--compile]\nPrivate files stay in DIR. Separate HTTPS main/content hosts must proxy to their respective loopback ports. Startup uses rootless Docker; Ctrl+C stops this stack.'); return; }
  if (parsed.positionals.length !== 1 || !['init', 'start'].includes(action)) throw new Error('Use init or start; see --help');
  const allowed = action === 'init' ? ['directory', 'instance', 'origin', 'content-origin', 'server-name', 'administrator'] : ['directory', 'port', 'content-port', 'compile'];
  if (Object.keys(parsed.values).some(key => !allowed.includes(key))) throw new Error('Invalid option for ' + action + '; see --help');
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 26) throw new Error('Linux and Node.js 26+ required');
  if (!parsed.values.directory) throw new Error('Supply an explicit --directory');
  const directory = resolve(parsed.values.directory);
  if (action === 'init') {
    if (existsSync(directory) && readdirSync(directory).length) throw new Error('Initialization requires an empty directory; existing data is never overwritten');
    const username = parsed.values.administrator;
    if (!username || !/^[a-z0-9._=-]{1,80}$/u.test(username) || username === 'conduit' || username.startsWith('crossfire-') || username.startsWith('agent-')) throw new Error('Supply a regular human --administrator username');
    const token = () => randomBytes(32).toString('base64url');
    const configuration = config({ instance: parsed.values.instance, serverName: parsed.values['server-name'], publicOrigin: parsed.values.origin,
      contentOrigin: parsed.values['content-origin'], matrixOrigin: 'http://127.0.0.1:6167', administrator: '@' + username + ':' + parsed.values['server-name'], jwtSecret: token(), registrationSecret: token() });
    if (!configuration.ok) throw new Error(configuration.error.message);
    privateDir(directory);
    writeJson(join(directory, 'config.json'), configuration.value);
    writeJson(join(directory, 'bootstrap.json'), { servicePassword: token(), administratorPassword: token() });
    console.log('Initialized ' + directory + '\nAdministrator: ' + configuration.value.administrator + '\nInitial password: administratorPassword in ' + join(directory, 'bootstrap.json'));
    return;
  }
  const configuration = config(readJson(join(directory, 'config.json')));
  if (!configuration.ok) throw new Error(configuration.error.message);
  const port = Number(parsed.values.port ?? (new URL(configuration.value.publicOrigin).port || '8080'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024..65535');
  const contentPort = Number(parsed.values['content-port'] ?? '8082');
  if (!Number.isInteger(contentPort) || contentPort < 1024 || contentPort > 65535 || contentPort === port) throw new Error('Content port must be separate and within 1024..65535');
  const docker = spawnSync('docker', ['info', '--format', '{{json .SecurityOptions}}'], { encoding: 'utf8' });
  if (docker.status !== 0 || !docker.stdout.includes('rootless')) throw new Error('A working rootless Docker engine is required; no host changes are made by Crossfire');
  const image = imageName(repository);
  if (parsed.values.compile || spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) await command(['build', '--file', join(root, 'Dockerfile'), '--tag', image, repository]);
  const options = runArguments(directory, image, port, contentPort);
  const name = options[options.indexOf('--name') + 1]!;
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; void command(['stop', '--time', '15', name]).catch(error => console.error(String(error))); } };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
  try { await command(options); }
  finally { for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(signal, stop); }
}
