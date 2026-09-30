import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { codexTerminal } from '@crossfire/adapter-codex/terminal';
import { value } from './support/application.js';

const execute = promisify(execFile);
test('Codex terminal adapter quotes native arguments and keeps the token out of the command', async () => {
  const directory = mkdtempSync(join(process.cwd(), ".temp/terminal-'quoted-"));
  const tokenFile = join(directory, 'token'), output = join(directory, 'output'), binary = join(directory, "native-'client");
  writeFileSync(tokenFile, 'private-fixture-capability', { mode: 0o600 });
  writeFileSync(binary, '#!' + process.execPath + '\nimport {writeFileSync} from "node:fs";writeFileSync(' + JSON.stringify(output)
    + ',JSON.stringify({arguments:process.argv.slice(2),token:process.env.FLEET_RUNTIME_AUTH_TOKEN,home:process.env.CODEX_HOME}),{mode:0o600});', { mode: 0o700 });
  const descriptor = { runtime: 'codex', sessionId: randomUUID(), workspace: directory + '/workspace; never-execute', connection: { endpoint: 'ws://127.0.0.1:12345', tokenFile, home: directory, binary, path: process.env.PATH! } };
  const adapter = codexTerminal(), command = value(adapter.command(descriptor));
  assert(!command.includes('private-fixture-capability'));
  await execute('/bin/sh', ['-c', command]);
  const captured = JSON.parse(readFileSync(output, 'utf8')) as { arguments: string[]; token: string; home: string };
  assert.deepEqual(captured.arguments, ['--remote', 'ws://127.0.0.1:12345/', '--remote-auth-token-env', 'FLEET_RUNTIME_AUTH_TOKEN',
    '--cd', descriptor.workspace, 'resume', descriptor.sessionId]);
  assert.equal(captured.token, 'private-fixture-capability');
  assert.equal(captured.home, directory);
  for (const invalid of [{ runtime: 'other' }, { sessionId: 'guess' }, { workspace: 'relative' },
    ...[{ tokenFile: 'relative' }, { tokenFile: '/invalid\npath' }, { home: 'relative' }, { binary: 'unsafe\nprogram' }, { path: '' }, { endpoint: 'ws://remote.example:12345' },
      { endpoint: 'ws://127.0.0.1:12345/?token=secret' }, { extra: 'unknown' }].map(fields => ({ connection: { ...descriptor.connection, ...fields } }))]) {
    assert.equal(adapter.command({ ...descriptor, ...invalid }).ok, false);
  }
});
