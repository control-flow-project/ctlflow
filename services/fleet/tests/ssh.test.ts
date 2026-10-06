import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { trustWorkspace } from '@ctlflow/crossfire-test-support/codex';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createProvider } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { openTunnel } from '@ctlflow/fleet-ssh-transport/tunnel';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';
import { sshTerminalCommand } from '@ctlflow/fleet-ssh-transport/terminal';
import { codexTerminal } from '@ctlflow/crossfire-adapter-codex/terminal';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import type { OwnedRuntimeConnection } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
test('native SSH forwards the private controller API, attaches the exact Codex TUI and leaves the daemon running', { timeout: 90000 }, async scope => {
  const directory = mkdtempSync(join(homedir(), '.fleet-ssh-proof-')), root = join(directory, 'controller');
  const bin = join(directory, 'bin'), home = join(directory, 'home');
  mkdirSync(bin, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
  const env = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(directory, 'config') };
  const command = (...args: string[]) => execute(process.execPath, [cli, ...args], { env, timeout: 15000 });
  const stop = new AbortController();
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined, sshd: ReturnType<typeof spawn> | undefined, ended: Promise<unknown> | undefined;
  let nativeRuntime: OwnedRuntimeConnection | undefined, terminal: ReturnType<typeof spawn> | undefined, terminalEnded: Promise<unknown> | undefined;
  cleanup(scope, async () => { terminal?.kill('SIGTERM'); await terminalEnded; await nativeRuntime?.close(); stop.abort(); await tunnel?.close(); sshd?.kill('SIGTERM'); await ended; await command('daemon', 'stop').catch(() => {}); rmSync(directory, { recursive: true, force: true }); });
  await command('daemon', 'start', '--root', root, '--name', 'ssh-proof');
  for (const key of ['host', 'client', 'wrong-host']) await execute('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(directory, key)]);
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const port = address.port, known = join(directory, 'known_hosts'), config = join(directory, 'ssh_config');
  const trusted = (key: string) => '[127.0.0.1]:' + port + ' ' + readFileSync(join(directory, key + '.pub'), 'utf8');
  writeFileSync(known, trusted('host'), { mode: 0o600 });
  writeFileSync(config, 'Host fixture\n  HostName 127.0.0.1\n  Port ' + port + '\n  User ' + userInfo().username
    + '\n  IdentityFile ' + join(directory, 'client') + '\n  IdentitiesOnly yes\n  BatchMode yes\n  UserKnownHostsFile ' + known + '\n', { mode: 0o600 });
  writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexec /usr/bin/ssh -F ' + JSON.stringify(config) + ' "$@"\n', { mode: 0o700 });
  const daemonConfig = join(directory, 'sshd_config');
  writeFileSync(daemonConfig, 'Port ' + port + '\nListenAddress 127.0.0.1\nHostKey ' + join(directory, 'host')
    + '\nPidFile ' + join(directory, 'sshd.pid') + '\nAuthorizedKeysFile ' + join(directory, 'client.pub')
    + '\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes yes\nLogLevel VERBOSE\nAllowStreamLocalForwarding local\nAllowTcpForwarding local\n', { mode: 0o600 });
  sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', daemonConfig], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = ''; sshd.stderr!.on('data', chunk => { log += String(chunk); });
  ended = once(sshd, 'close');
  for (let attempt = 0; !log.includes('Server listening') && attempt < 100; attempt++) { assert.equal(sshd.exitCode, null, log); await delay(30); }
  assert(log.includes('Server listening'), log);
  const previousPath = process.env.PATH; process.env.PATH = bin + ':' + previousPath;
  cleanup(scope, () => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  tunnel = await openTunnel('fixture', root, AbortSignal.any([stop.signal, scope.signal])).catch(error => { throw new Error(String(error) + '\n' + log); });
  const status = await createDaemonClient(tunnel.socketPath, AbortSignal.timeout(5000)).call(operations.status, {}, {});
  assert(status.ok, JSON.stringify(status) + '\n' + log); assert.equal(status.value.data.controller.name, 'ssh-proof');
  await tunnel.close(); assert.equal(existsSync(tunnel.socketPath), false);
  assert((await createDaemonClient(join(root, 'fleetd.sock')).call(operations.status, {}, {})).ok);
  const tokenFile = join(directory, "private-'token"), native = join(bin, "native-'terminal");
  writeFileSync(tokenFile, 'private-terminal-proof', { mode: 0o600 });
  writeFileSync(native, '#!' + process.execPath + '\nconsole.log(JSON.stringify({arguments:process.argv.slice(2),authenticated:process.env.FLEET_RUNTIME_AUTH_TOKEN==="private-terminal-proof"}));', { mode: 0o700 });
  const descriptor = { runtime: 'codex', sessionId: randomUUID(), workspace: directory + '/workspace;literal', connection: { endpoint: 'ws://127.0.0.1:12345', tokenFile, home, binary: "native-'terminal", path: process.env.PATH! } };
  const nativeCommand = codexTerminal().command(descriptor); assert(nativeCommand.ok);
  const remoteCommand = sshTerminalCommand('fixture', nativeCommand.value);
  assert(!remoteCommand.includes('private-terminal-proof'));
  const attached = JSON.parse((await execute('/bin/sh', ['-c', remoteCommand], { timeout: 10000 })).stdout) as { arguments: string[]; authenticated: boolean };
  assert(attached.authenticated); assert(attached.arguments.includes(descriptor.workspace)); assert(attached.arguments.includes(descriptor.sessionId));
  assert((await createDaemonClient(join(root, 'fleetd.sock')).call(operations.status, {}, {})).ok);
  const workspace = join(directory, 'workspace'), nativeHome = join(workspace, '.codex');
  mkdirSync(nativeHome, { recursive: true, mode: 0o700 });
  writeFileSync(join(nativeHome, 'auth.json'), '{}', { mode: 0o600 });
  let modelCalls = 0;
  const requests: { method: string | undefined; path: string | undefined }[] = [];
  const provider = createProvider((request, response) => {
    requests.push({ method: request.method, path: request.url });
    if (request.method === 'POST') modelCalls++;
    response.writeHead(404); response.end('{}');
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  cleanup(scope, () => new Promise<void>(resolve => { provider.closeAllConnections(); provider.close(() => resolve()); }));
  const providerAddress = provider.address(); assert(providerAddress && typeof providerAddress !== 'string');
  writeFileSync(join(nativeHome, 'config.toml'), 'model_provider = "fixture"\n[model_providers.fixture]\nname = "Inert SSH fixture"\nbase_url = "http://127.0.0.1:' + providerAddress.port + '/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n', { mode: 0o600 });
  trustWorkspace(nativeHome, workspace);
  const runtime = await codexRuntime().start({ name: 'ssh-native', workspace, stateDirectory: workspace, instructions: 'Inert verification. No work is requested.', allowNewHistory: true,
    options: { model: 'gpt-5.1', model_reasoning_effort: 'medium', sandbox_mode: 'read-only', approval_policy: 'never' },
    hooks: { requestDecision: async () => { throw new Error('No tool approval is expected'); } } }, scope.signal);
  assert(runtime.ok); nativeRuntime = runtime.value;
  const realPointer = codexTerminal().command(nativeRuntime.attachment); assert(realPointer.ok);
  const realRemote = sshTerminalCommand('fixture', realPointer.value);
  terminal = spawn('/usr/bin/script', ['--quiet', '--return', '--flush', '--command', 'stty cols 110 rows 35; ' + realRemote, '/dev/null'],
    { env: { ...process.env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
  terminalEnded = once(terminal, 'close');
  let terminalOutput = '';
  terminal.stdout!.on('data', (chunk: Buffer) => {
    terminalOutput = (terminalOutput + chunk.toString()).slice(-1024 * 1024);
    if (chunk.includes('\x1b[6n')) terminal!.stdin!.write('\x1b[1;1R');
  });
  terminal.stderr!.on('data', (chunk: Buffer) => { terminalOutput = (terminalOutput + chunk.toString()).slice(-1024 * 1024); });
  async function observe(predicate: () => boolean) {
    const deadline = Date.now() + 25000;
    while (!predicate()) { assert.equal(terminal!.exitCode, null, terminalOutput); assert(Date.now() < deadline, terminalOutput); await delay(30); }
  }
  await observe(() => terminalOutput.includes('gpt-5.1'));
  terminal.stdin!.write('/quit'); await observe(() => terminalOutput.includes('/quit')); terminal.stdin!.write('\r');
  await observe(() => terminal!.exitCode !== null || terminal!.signalCode !== null);
  assert.deepEqual(await terminalEnded, [0, null], terminalOutput);
  assert.equal(nativeRuntime.signal.aborted, false);
  assert.equal(await nativeRuntime.turnControl.activeTurn(), null);
  assert.equal(modelCalls, 0, 'Real SSH TUI attachment and exit make no model calls: ' + JSON.stringify(requests));
  await nativeRuntime.close(); nativeRuntime = undefined;
  assert((await createDaemonClient(join(root, 'fleetd.sock')).call(operations.status, {}, {})).ok);
  writeFileSync(known, trusted('wrong-host'), { mode: 0o600 });
  await assert.rejects(openTunnel('fixture', root, stop.signal), /SSH tunnel closed/);
  assert((await createDaemonClient(join(root, 'fleetd.sock')).call(operations.status, {}, {})).ok);
});
