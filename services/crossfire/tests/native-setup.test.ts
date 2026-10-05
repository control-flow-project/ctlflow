import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareProject } from '@ctlflow/crossfire-adapter-filesystem/project';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { installClaudeHook } from '@ctlflow/crossfire-adapter-claude/hook';
import { installPiExtension } from '@ctlflow/crossfire-adapter-pi/discovery';
import { selectProfile } from '../apps/client/src/connect.js';
import { listenerSettings } from '../apps/client/src/settings.js';
import { connectionSetup } from '../apps/client/src/setup.js';
import { runtimeName, discoverRuntime } from '../apps/client/src/adapters.js';

function project(): string {
  mkdirSync('.temp', { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/native-setup-'));
  execFileSync('git', ['init', '--quiet', directory]);
  return prepareProject(directory);
}

test('native activation retains first-setup choices without another name, server or enrollment prompt', () => {
  const directory = project();
  const state = join(directory, '.crossfire/state/charlie');
  listenerSettings(state, 'pi').save();
  connectionSetup(state).save('https://crossfire.example', '@owner:example');
  assert.equal(selectProfile(directory), 'charlie');
  const saved = listenerSettings(state);
  assert.equal(saved.runtime, 'pi');
  const setup = connectionSetup(state);
  assert.deepEqual(setup.value, { server: 'https://crossfire.example', owner: '@owner:example' });
  assert.equal(statSync(join(state, 'settings.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(state, 'setup.json')).mode & 0o777, 0o600);
  assert.throws(() => setup.save('https://different.example', '@owner:example'), /different server or owner/);
  assert.throws(() => setup.save('https://crossfire.example', '@other:example'), /different server or owner/);
  listenerSettings(join(directory, '.crossfire/state/bea'), 'claude').save();
  assert.throws(() => selectProfile(directory), /bea, charlie/);
  assert.equal(selectProfile(directory, 'charlie'), 'charlie');
  setup.complete();
  assert.equal(connectionSetup(state).value, undefined);
  assert.equal(listenerSettings(state).runtime, 'pi');
});

test('native runtime selection and permissions fail explicitly without guessing or retaining another adapter policy', () => {
  const directory = project(), state = join(directory, '.crossfire/state/charlie');
  assert.equal(runtimeName(undefined, { CLAUDE_CODE_SESSION_ID: 'native' }), 'claude');
  assert.equal(runtimeName(undefined, { CROSSFIRE_PI_CONNECTION: 'native' }), 'pi');
  assert.throws(() => runtimeName(undefined, { CLAUDE_CODE_SESSION_ID: 'native', CODEX_THREAD_ID: 'native' }), /Multiple runtime contexts/);
  assert.throws(() => discoverRuntime('opencode', directory), /Supported runtime adapters/);
  listenerSettings(state, 'codex').save();
  assert.equal(listenerSettings(state, 'claude').runtime, 'claude');
  writeJson(join(state, 'settings.json'), { runtime: 'pi', approvalRoom: null, server: 'https://crossfire.example', owner: '@owner:example' });
  assert.throws(() => listenerSettings(state), /Invalid listener settings/);
  writeJson(join(state, 'setup.json'), { server: 'not-an-origin', owner: '@owner:example' });
  assert.throws(() => connectionSetup(state), /Invalid project connection setup/);
  writeJson(join(state, 'setup.json'), { server: 'https://crossfire.example/', owner: '@owner:example' });
  assert.throws(() => connectionSetup(state), /Invalid project connection setup/);
});

test('private listener settings migrate once to runtime-only and preserve reconnect and adapter selection', () => {
  const directory = project(), state = join(directory, '.crossfire/state/charlie');
  const original = { runtime: 'codex', approvalRoom: '!approval:example' };
  writeJson(join(state, 'settings.json'), original);
  const codex = listenerSettings(state);
  assert.equal(codex.runtime, 'codex');
  codex.save();
  assert.deepEqual(readJson(join(state, 'settings.json')), { runtime: 'codex' });
  assert.equal(connectionSetup(state).value, undefined);
  const claude = listenerSettings(state, 'claude');
  claude.save();
  assert.deepEqual(readJson(join(state, 'settings.json')), { runtime: 'claude' });
});

test('Claude project hooks are private, idempotent and preserve unrelated native configuration', () => {
  const directory = project(), file = join(directory, '.claude/settings.local.json');
  mkdirSync(join(directory, '.claude'));
  const original = { permissions: { defaultMode: 'default' }, env: { FIXTURE: 'preserved' },
    hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'existing-hook' }] }] } };
  writeFileSync(file, JSON.stringify(original));
  installClaudeHook(directory);
  const first = readFileSync(file);
  installClaudeHook(directory);
  assert.deepEqual(readFileSync(file), first);
  const installed = readJson<typeof original & { hooks: Record<string, unknown[]> }>(file);
  assert.deepEqual(installed.permissions, original.permissions);
  assert.deepEqual(installed.env, original.env);
  assert.deepEqual(installed.hooks.PreToolUse[0], original.hooks.PreToolUse[0]);
  assert.equal(installed.hooks.PreToolUse.length, 2);
  assert.equal(installed.hooks.PostToolUse?.length, 1);
  assert.equal(installed.hooks.SessionStart?.length, 1);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  execFileSync('git', ['-C', directory, 'check-ignore', '--quiet', '.claude/settings.local.json']);
});

test('Pi project integration refuses foreign files and links instead of replacing them', () => {
  const directory = project(), path = join(directory, '.pi/extensions');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'crossfire.js'), 'foreign native extension');
  assert.throws(() => installPiExtension(directory), /non-managed Pi extension/);
  assert.equal(readFileSync(join(path, 'crossfire.js'), 'utf8'), 'foreign native extension');
  const linked = project(), target = join(linked, 'foreign');
  mkdirSync(target);
  symlinkSync(target, join(linked, '.pi'));
  assert.throws(() => installPiExtension(linked), /owned project/);
  assert.equal(existsSync(join(target, 'extensions')), false);
});
