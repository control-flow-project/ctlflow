import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { contractProcess, freePorts, observe } from '@ctlflow/crossfire-test-support/contract-process';

export async function sshFixture(scope: TestContext, configurationHome: string) {
  const directory = mkdtempSync(join(homedir(), '.fleet-ssh-contract-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin'); mkdirSync(bin, { mode: 0o700 });
  const execute = promisify(execFile);
  for (const name of ['host', 'client', 'wrong-host']) await execute('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(directory, name)], { timeout: 15000 });
  const [port] = await freePorts(scope), known = join(directory, 'known_hosts'), configuration = join(directory, 'ssh_config');
  const trust = (name: string) => writeFileSync(known, '[127.0.0.1]:' + port + ' ' + readFileSync(join(directory, name + '.pub'), 'utf8'), { mode: 0o600 }); trust('host');
  writeFileSync(configuration, 'Host fixture\n  HostName 127.0.0.1\n  Port ' + port + '\n  User ' + userInfo().username + '\n  IdentityFile ' + join(directory, 'client') + '\n  IdentitiesOnly yes\n  BatchMode yes\n  UserKnownHostsFile ' + known + '\n', { mode: 0o600 });
  writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexec /usr/bin/ssh -F ' + JSON.stringify(configuration) + ' "$@"\n', { mode: 0o700 });
  const server = join(directory, 'sshd_config');
  writeFileSync(server, 'Port ' + port + '\nListenAddress 127.0.0.1\nHostKey ' + join(directory, 'host') + '\nPidFile ' + join(directory, 'sshd.pid') + '\nAuthorizedKeysFile ' + join(directory, 'client.pub') + '\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes yes\nLogLevel VERBOSE\nAllowStreamLocalForwarding local\nAllowTcpForwarding local\nSetEnv XDG_CONFIG_HOME=' + configurationHome + '\n', { mode: 0o600 });
  const process = contractProcess(scope, { binary: '/usr/sbin/sshd', arguments: ['-D', '-e', '-f', server] }, [], directory);
  await observe(() => { assert.equal(process.alive(), true, process.errors()); return process.errors().includes('Server listening'); }, 'Isolated native SSH server must become ready');
  return { bin, distrust: () => trust('wrong-host') };
}
