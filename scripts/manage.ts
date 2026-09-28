import { parseArgs } from 'node:util';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, DATA, INSTANCES, CONFIGURATIONS, validate, type InstanceConfig } from './instance.ts';
import { configure } from './bootstrap.ts';
import { HEARTBEAT_INTERVAL_MS } from './lease.ts';
import { onboarding, CLIENT_FORMAT, type ClientFiles } from './onboarding.ts';
import { buildInfo, requireNode, type RuntimeInfo } from './version.ts';
import { name, readJson, readSettings, roomCatalog, writeJson, emit, acquireProcessLock } from '../skills/conduit-chat/scripts/lib.ts';

const runtimeFiles = ['Dockerfile', '.dockerignore', '.npmrc', 'package.json', 'package-lock.json',
  'scripts/bootstrap.ts', 'scripts/container.ts', 'scripts/instance.ts', 'scripts/room-service.ts',
  'scripts/lease.ts', 'scripts/control-auth.ts', 'scripts/onboarding.ts', 'scripts/version.ts',
  'skills/conduit-chat/scripts/lib.ts', 'skills/conduit-chat/scripts/limits.ts'];
const storeId = createHash('sha256').update(DATA).digest('hex').slice(0, 12);
export const containerName = (instance: string) => `crossfire-${name(instance)}-${storeId}`;

function docker(args: string[], quiet = false): string {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'] });
  if (result.error) throw new Error('Docker is unavailable. Ensure docker info works for your user.');
  if (result.status !== 0) throw new Error(quiet ? result.stderr.trim() || 'Docker command failed' : 'Docker command failed; see its output above');
  return result.stdout ?? '';
}
function requireDocker(): void {
  const info = JSON.parse(docker(['info', '--format', '{{json .}}'], true)) as { OSType?: string; OperatingSystem?: string; SecurityOptions?: string[] };
  if (info.OSType !== 'linux') throw new Error('Select a Docker engine that runs Linux containers');
  if (!info.SecurityOptions?.some(option => option.includes('rootless')) && !info.OperatingSystem?.includes('Docker Desktop')) {
    throw new Error('Crossfire expects rootless Docker or Docker Desktop accessible to your current user');
  }
}
function inspect(instance: string): { State: { Running: boolean }; Config: { Labels: Record<string, string> } } | undefined {
  const result = spawnSync('docker', ['container', 'inspect', containerName(instance)], { encoding: 'utf8' });
  if (result.error) throw new Error('Docker is unavailable');
  if (result.status !== 0) {
    if (/no such (object|container)/i.test(result.stderr)) return undefined;
    throw new Error(result.stderr.trim() || 'Cannot inspect the container');
  }
  const info = JSON.parse(result.stdout)[0];
  if (info.Config.Labels?.['org.crossfire.store'] !== storeId || info.Config.Labels?.['org.crossfire.instance'] !== instance) {
    throw new Error('Container name belongs to another application; refusing to alter it');
  }
  return info;
}
export function imageName(): string {
  const hash = createHash('sha256');
  for (const file of runtimeFiles) hash.update(file).update(readFileSync(join(ROOT, file)));
  return 'crossfire-runtime:' + hash.digest('hex').slice(0, 20);
}
async function buildImage(compile = false): Promise<string> {
  requireDocker();
  const image = imageName();
  const release = await acquireProcessLock(join(DATA, 'image-build'));
  try {
    if (compile || spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
      if (compile) console.log('Rebuilding runtime image ' + image);
      await new Promise<void>((resolveBuild, reject) => {
        const child = spawn('docker', ['build', '--tag', image, '--file', join(ROOT, 'Dockerfile'), ROOT], { stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolveBuild() : reject(new Error('Docker build failed; see its output above')));
      });
    }
  } finally { await release(); }
  return image;
}
export function runArguments(config: InstanceConfig, folder: string, image: string, runId: string): string[] {
  // Docker --mount uses CSV, independently of the shell. Quote the entire
  // source field so commas, spaces, and quotes in checkout/data paths survive.
  const source = '"source=' + folder.replaceAll('"', '""') + '"';
  return ['run', '--rm', '--name', containerName(config.id),
    '--label', 'org.crossfire.store=' + storeId, '--label', 'org.crossfire.instance=' + config.id,
    '--publish', `127.0.0.1:${config.matrix_port}:${config.matrix_port}`,
    '--publish', `127.0.0.1:${config.web_port}:${config.web_port}`,
    '--mount', `type=bind,${source},target=/runtime/instances/${config.id}`,
    '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--env', 'CROSSFIRE_RUN_ID=' + runId,
    image, '--instance', config.id];
}
function details(instance: string) {
  const settings = readSettings(join(INSTANCES, name(instance), 'private/settings.json'));
  return { instance, ui: settings.room_service, homeserver: settings.homeserver, observer: settings.observer,
    default_room: settings.default_room, rooms: settings.rooms, container: containerName(instance), data_directory: join(INSTANCES, instance),
    login_file: join(INSTANCES, instance, 'private/web-login.txt') };
}
async function waitReady(config: InstanceConfig, runId: string, signal: AbortSignal): Promise<RuntimeInfo> {
  for (let attempt = 0; attempt < 150; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(`http://127.0.0.1:${config.web_port}/_coord/health`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) });
      const health = await response.json() as RuntimeInfo & { instance?: string; run_id?: string; status?: string };
      if (response.ok && health.instance === config.id && health.run_id === runId && health.status === 'ready') {
        return { build: health.build, started_at: health.started_at, node: health.node, client_sha256: health.client_sha256 };
      }
    } catch { /* still starting */ }
    await delay(200, undefined, { signal });
  }
  throw new Error('Instance did not become ready; see the container output');
}
async function start(path: string, compile: boolean): Promise<void> {
  const original = readJson<unknown>(path);
  const config = validate(original);
  const image = await buildImage(compile);
  const files = clientFiles();
  const build = buildInfo(ROOT, image);
  const release = await acquireProcessLock(join(INSTANCES, config.id, 'running'));
  let controller: AbortController | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  let stopping = false;
  let running = false;
  let finished = false;
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping = true;
    if (!running || finished) return Promise.resolve();
    return stopPromise ??= new Promise(resolveStop => {
      const child = spawn('docker', ['stop', '--time', '10', containerName(config.id)], { stdio: 'ignore' });
      child.once('error', () => resolveStop()); child.once('exit', () => resolveStop());
    });
  };
  const onSignal = () => { void stop(); };
  let tick: ((stopped?: boolean) => void) | undefined;
  try {
    const existing = inspect(config.id);
    if (existing?.State.Running) throw new Error('This instance is already running in another terminal');
    if (existing) docker(['rm', containerName(config.id)], true);
    const configureRelease = await acquireProcessLock(join(INSTANCES, 'configure'));
    let privatePath: string;
    try { ({ privatePath } = configure(config)); } finally { await configureRelease(); }
    writeJson(join(privatePath, 'client-files.json'), files);
    writeJson(join(privatePath, 'build.json'), build);
    writeFileSync(join(privatePath, 'install.mjs'), readFileSync(join(ROOT, 'dist/install.mjs')), { mode: 0o600 });
    const runId = randomUUID();
    let sequence = 0;
    tick = (stopped = false) => writeJson(join(privatePath, 'lease.json'), { run_id: runId, sequence: sequence++, stopped });
    tick();
    const child = spawn('docker', runArguments(config, join(INSTANCES, config.id), image, runId), { stdio: ['ignore', 'inherit', 'inherit'] });
    running = true;
    const completion = new Promise<number | null>((resolveExit, reject) => {
      child.once('error', error => { finished = true; reject(error); });
      child.once('exit', code => { finished = true; resolveExit(code); });
    });
    for (const signal of signals) process.on(signal, onSignal);
    heartbeat = setInterval(() => {
      try { tick!(); } catch (error) { console.error('Cannot renew instance heartbeat:', error); void stop(); }
    }, HEARTBEAT_INTERVAL_MS);
    controller = new AbortController();
    try {
      const runtime = await Promise.race([waitReady(config, runId, controller.signal), completion.then(code => { throw new Error(`Container exited before startup completed (${code})`); })]);
      emit({ ...details(config.id), ...runtime });
      console.log(onboarding(readSettings(join(privatePath, 'settings.json'))));
      console.log('Instance is running in this terminal. Press Ctrl+C to stop.');
      const code = await completion;
      if (code !== 0 && !stopping) throw new Error(`Container exited with status ${code}`);
    } catch (error) { if (!stopping) throw error; }
  } finally {
    controller?.abort();
    if (heartbeat) clearInterval(heartbeat);
    try { tick?.(true); } catch { /* an expired lease also shuts down the container */ }
    await stop();
    for (const signal of signals) process.removeListener(signal, onSignal);
    await release();
  }
}
function clientFiles(): ClientFiles {
  const built = spawnSync(process.execPath, [join(ROOT, 'scripts/build-client.ts')], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr || 'Client build failed; run npm ci in the checkout');
  const source = join(ROOT, 'skills/conduit-chat');
  const files: ClientFiles = {};
  for (const file of ['SKILL.md', 'scripts/chat', 'scripts/package.json']) files[file] = readFileSync(join(source, file), 'utf8');
  files['scripts/chat.mjs'] = readFileSync(join(ROOT, 'dist/chat.mjs'), 'utf8');
  files['licenses/matrix-spec.txt'] = readFileSync(join(ROOT, 'third-party/matrix-spec-LICENSE'), 'utf8');
  return files;
}
function clientBundle(instance: string) {
  const settings = readSettings(join(INSTANCES, name(instance), 'private/settings.json'));
  if (settings.rooms.some(room => !room.room_id)) throw new Error('Wait for the instance to finish starting before installing its client');
  roomCatalog(settings);
  return { format: CLIENT_FORMAT, settings, files: clientFiles() };
}
function installClient(instance: string, options: Record<string, string | boolean | undefined>): void {
  const args = [join(ROOT, 'scripts/install-client.ts')];
  for (const option of ['skill-dir', 'config-dir', 'state-dir']) if (typeof options[option] === 'string') args.push('--' + option, options[option] as string);
  const result = spawnSync(process.execPath, args, { input: JSON.stringify(clientBundle(instance)), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Client installation failed');
  process.stdout.write(result.stdout);
}
function exportClient(instance: string, destination: string): void {
  const folder = resolve(destination);
  const fromRoot = relative(ROOT, folder);
  if (!fromRoot || (!fromRoot.startsWith('..' + sep) && fromRoot !== '..' && !isAbsolute(fromRoot))) throw new Error('Export credentials outside the source checkout');
  const bundle = clientBundle(instance);
  if (existsSync(folder)) throw new Error('Choose a new directory for the client bundle');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeJson(join(folder, 'client.json'), bundle);
  writeFileSync(join(folder, 'install.mts'), readFileSync(join(ROOT, 'dist/install.mjs')), { mode: 0o600 });
  emit({ instance, directory: folder, installer: join(folder, 'install.mts'), bundle: join(folder, 'client.json') });
}
export async function main(): Promise<void> {
  requireNode();
  const usage = 'Usage: node crossfire COMMAND\n'
    + '  init INSTANCE [--matrix-port N] [--web-port N]  Create a private configuration\n'
    + '  start CONFIG_OR_INSTANCE [--compile]          Rebuild if requested, then run in this terminal\n'
    + '  stop INSTANCE                                 Stop a running instance; retain its data\n'
    + '  info INSTANCE                                 Show URLs, storage, and login-file path\n'
    + '  onboarding INSTANCE                           Print copyable HTTP client installation instructions\n'
    + '  status INSTANCE                               Show whether its container is running\n'
    + '  logs INSTANCE                                 Show recent container logs\n'
    + '  build                                         Build/cache the Docker image\n'
    + '  install-client INSTANCE [--skill-dir PATH] [--config-dir PATH] [--state-dir PATH]\n'
    + '  export-client INSTANCE NEW_DIR                 Export a private client installation bundle\n'
    + '  --help';
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, 'skill-dir': { type: 'string' }, 'config-dir': { type: 'string' },
    'state-dir': { type: 'string' }, 'matrix-port': { type: 'string' }, 'web-port': { type: 'string' }, compile: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); return; }
  const [command, value, destination] = positionals;
  const allowed = command === 'init' ? ['matrix-port', 'web-port'] : command === 'install-client' ? ['skill-dir', 'config-dir', 'state-dir'] : command === 'start' ? ['compile'] : [];
  if (Object.keys(values).some(option => !allowed.includes(option))) throw new Error('Unsupported option for this command\n' + usage);
  if (positionals.length > (command === 'export-client' ? 3 : command === 'build' ? 1 : 2)) throw new Error(usage);
  if (command === 'init' && value) {
    const id = name(value);
    const path = join(CONFIGURATIONS, id + '.json');
    if (existsSync(path)) throw new Error('Configuration already exists: ' + path);
    const config = readJson<InstanceConfig>(join(ROOT, 'examples/project-one.json'));
    config.id = id; config.server_name = id + '.localhost'; config.label = id + ' agents';
    for (const room of config.rooms) room.name = id + ' ' + room.alias;
    if (values['matrix-port']) config.matrix_port = Number(values['matrix-port']);
    if (values['web-port']) config.web_port = Number(values['web-port']);
    writeJson(path, validate(config)); emit({ instance: id, configuration: path });
  } else if (command === 'build') { emit({ image: await buildImage() }); }
  else if (command === 'start' && value) {
    const configured = join(CONFIGURATIONS, name(existsSync(value) ? 'unused' : value) + '.json');
    await start(existsSync(value) ? value : existsSync(configured) ? configured : join(INSTANCES, value, 'instance.json'), values.compile === true);
  } else if (command === 'install-client' && value) installClient(value, values);
  else if (command === 'export-client' && value && destination) exportClient(value, destination);
  else if (command === 'info' && value) emit(details(value));
  else if (command === 'onboarding' && value) console.log(onboarding(readSettings(join(INSTANCES, name(value), 'private/settings.json'))));
  else if (['stop', 'status', 'logs'].includes(command) && value) {
    requireDocker(); const existing = inspect(name(value));
    if (command === 'status') emit({ instance: value, running: existing?.State.Running ?? false, container: containerName(value) });
    else if (command === 'stop') { if (existing?.State.Running) docker(['stop', '--time', '10', containerName(value)]); }
    else if (existing) docker(['logs', '--tail', '100', containerName(value)]);
    else throw new Error('Instance is stopped; container logs are available while it runs');
  } else throw new Error(usage);
}

if (process.argv[1] && resolve(process.argv[1]) === join(ROOT, 'scripts/manage.ts')) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Crossfire command failed'); process.exitCode = 1; });
}
