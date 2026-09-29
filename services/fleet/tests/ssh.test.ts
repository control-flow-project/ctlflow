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
import { setTimeout as delay } from 'node:timers/promises';
import { openTunnel } from '@fleet/ssh-transport/tunnel';
import { createDaemonClient, operations } from '@fleet/daemon-client/client';

const execute = promisify(execFile);
test('native SSH forwards the private controller API, verifies host keys and leaves the daemon running', { timeout: 30000 }, async scope => {
  const directory = mkdtempSync(join(homedir(), '.fleet-ssh-proof-')), root = join(directory, 'controller');
  const bin = join(directory, 'bin'), home = join(directory, 'home');
  mkdirSync(bin, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
  const env = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(directory, 'config') };
  const command = (...args: string[]) => execute(process.execPath, [cli, ...args], { env, timeout: 15000 });
  const stop = new AbortController();
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined, sshd: ReturnType<typeof spawn> | undefined, ended: Promise<unknown> | undefined;
  scope.after(async () => { stop.abort(); await tunnel?.close(); sshd?.kill('SIGTERM'); await ended; await command('daemon', 'stop').catch(() => {}); rmSync(directory, { recursive: true, force: true }); });
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
  scope.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  tunnel = await openTunnel('fixture', root, AbortSignal.any([stop.signal, scope.signal])).catch(error => { throw new Error(String(error) + '\n' + log); });
  const status = await createDaemonClient(tunnel.socketPath, AbortSignal.timeout(5000)).call(operations.status, {}, {});
  assert(status.ok, JSON.stringify(status) + '\n' + log); assert.equal(status.value.data.controller.name, 'ssh-proof');
  await tunnel.close(); assert.equal(existsSync(tunnel.socketPath), false);
  assert((await createDaemonClient(join(root, 'fleetd.sock')).call(operations.status, {}, {})).ok);
  writeFileSync(known, trusted('wrong-host'), { mode: 0o600 });
  await assert.rejects(openTunnel('fixture', root, stop.signal), /SSH tunnel closed/);
  assert((await createDaemonClient(join(root, 'fleetd.sock')).call(operations.status, {}, {})).ok);
});
