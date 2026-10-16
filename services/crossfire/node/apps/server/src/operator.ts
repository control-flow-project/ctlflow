import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { captureDocker, cgroupArguments, runArguments, migrationArguments } from './container-commands.js';
import { config } from './config.js';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { backupBeforeMigration, prepareDatabaseUpgrade } from './database-upgrade.js';
import { standalone } from './standalone.js';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { ownedDocker, reconcileContainers } from './container-lifecycle.js';
import { prepareContainerPackage } from './container-package.js';

function port(value: string): number {
  const parsed = Number(value);
  if (!/^[1-9][0-9]{3,4}$/u.test(value) || parsed < 1024 || parsed > 65535) throw new Error('Port must be a canonical decimal integer within 1024..65535');
  return parsed;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args[0] === 'serve') { await standalone(args.slice(1)); return; }
  const parsed = parseArgs({ args, allowPositionals: true, tokens: true, options: { directory: { type: 'string' }, instance: { type: 'string' },
    origin: { type: 'string' }, 'content-origin': { type: 'string' }, 'server-name': { type: 'string' }, administrator: { type: 'string' }, port: { type: 'string' }, 'content-port': { type: 'string' },
    'cgroup-parent': { type: 'string' }, package: { type: 'string' }, help: { type: 'boolean' } } });
  const seen = new Set<string>();
  for (const token of parsed.tokens) if (token.kind === 'option') {
    if (seen.has(token.name)) throw new Error('Duplicated option --' + token.name);
    seen.add(token.name);
  }
  const action = parsed.positionals[0];
  if (parsed.values.help || !action) { console.log('crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\ncrossfire start --directory DIR --package PACKAGE_DIR [--port PORT] [--content-port PORT] [--cgroup-parent EXISTING.slice]\nPrivate files stay in DIR. A verified Docker package selects the backend without a source checkout. Separate HTTPS main/content hosts proxy to their loopback ports. Startup uses rootless Docker; Ctrl+C stops this stack.'); return; }
  if (parsed.positionals.length !== 1 || !['init', 'start'].includes(action)) throw new Error('Use init or start; see --help');
  const allowed = action === 'init' ? ['directory', 'instance', 'origin', 'content-origin', 'server-name', 'administrator'] : ['directory', 'package', 'port', 'content-port', 'cgroup-parent'];
  if (Object.keys(parsed.values).some(key => !allowed.includes(key))) throw new Error('Invalid option for ' + action + '; see --help');
  cgroupArguments(parsed.values['cgroup-parent']);
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
  const applicationPort = port(parsed.values.port ?? (new URL(configuration.value.publicOrigin).port || '8080'));
  const contentPort = port(parsed.values['content-port'] ?? '8082');
  if (contentPort === applicationPort) throw new Error('Content and application ports must differ');
  if (!parsed.values.package) throw new Error('Supply an explicit --package directory');
  const releaseOwnership = acquireFileLock(join(directory, 'operator'));
  const stopping = new AbortController();
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const stop = () => stopping.abort();
  for (const signal of signals) process.once(signal, stop);
  try {
    const docker = await captureDocker(['info', '--format', '{{json .SecurityOptions}}'], stopping.signal);
    if (docker.code !== 0 || !docker.output.includes('rootless')) throw new Error('A working rootless Docker engine is required; no host changes are made by Crossfire');
    const selected = await prepareContainerPackage(parsed.values.package, stopping.signal);
    const options = runArguments(directory, selected.runtimeImage, applicationPort, contentPort, parsed.values['cgroup-parent']);
    await prepareDatabaseUpgrade({
      async stopWriters() { await reconcileContainers(directory, stopping.signal); },
      async backup() { stopping.signal.throwIfAborted(); await backupBeforeMigration(directory); },
      async migrate() { await ownedDocker(migrationArguments(directory, selected.migrationImage, parsed.values['cgroup-parent']), stopping.signal); },
    });
    stopping.signal.throwIfAborted();
    console.log('Public: ' + configuration.value.publicOrigin + '/\nManagement: ' + configuration.value.publicOrigin + '/manage/\nContent: ' + configuration.value.contentOrigin + '/');
    await ownedDocker(options, stopping.signal);
  } catch (error) {
    if (!(stopping.signal.aborted && error instanceof Error && error.name === 'AbortError')) throw error;
  } finally { for (const signal of signals) process.removeListener(signal, stop); releaseOwnership(); }
}
