import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { claudeProvider } from './support/claude-provider.js';
import { until, matrixFixture, message, ROOM } from '../scripts/test-support/listener.js';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { readJson } from '@crossfire/adapter-filesystem/index';
import { piDescriptor } from '@crossfire/adapter-pi/protocol';
import { connectPi } from '@crossfire/adapter-pi/discovery';
import type { RuntimeAdapter } from '@crossfire/agent-core/runtime';
import { builtClient } from '../scripts/test-support/release.js';

test('installed Pi native extension confirms idle/busy inputs, exact interruption, Matrix batching and replacement', { timeout: 60000 }, async scope => {
  mkdirSync('.temp', { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/pi-native-'));
  const home = join(directory, 'home'), agent = join(home, '.pi/agent');
  mkdirSync(agent, { recursive: true, mode: 0o700 });
  const provider = await claudeProvider(scope, undefined, 2);
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { anthropic: { baseUrl: provider.base, apiKey: 'fixture-not-a-real-key' } } }));
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: { mode: 'off' } }));
  const child = spawn('pi', ['--mode', 'rpc', '--provider', 'anthropic', '--model', 'claude-sonnet-4-6', '--thinking', 'off', '--no-tools', '--offline', '--approve', '--no-extensions', '--extension', join(dirname(builtClient()), 'crossfire-pi.mjs'), '--session-dir', join(directory, 'sessions')], {
    cwd: directory, env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  scope.after(() => child.kill('SIGTERM'));
  let buffer = '', errors = '';
  const records: Record<string, unknown>[] = [];
  child.stderr.on('data', bytes => { errors += String(bytes); });
  child.stdout.on('data', bytes => {
    buffer += String(bytes);
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line.trim()) records.push(JSON.parse(line) as Record<string, unknown>); }
  });
  async function command(type: string, extra: Record<string, unknown> = {}) {
    const id = randomUUID(); child.stdin.write(JSON.stringify({ id, type, ...extra }) + '\n');
    await until(() => records.some(record => record.id === id) || child.exitCode !== null);
    const result = records.find(record => record.id === id);
    assert(result?.success, errors + JSON.stringify(result));
    return result.data as Record<string, unknown>;
  }
  const state = await command('get_state');
  const file = join(directory, '.crossfire/runtime/pi', String(state.sessionId) + '.json');
  const parsed = piDescriptor(readJson<unknown>(file)); assert(parsed.ok, errors);
  await command('prompt', { message: 'Bootstrap fixture.' });
  await until(() => records.some(record => record.type === 'agent_end'));
  const stop = new AbortController();
  const journal = join(directory, '.crossfire/runtime/pi', String(state.sessionId) + '.receipt');
  const adapter = await connectPi(parsed.value, journal, 100, stop.signal);
  scope.after(() => adapter.close());
  await adapter.deliver('Idle Pi input.', 'pi-idle');
  await until(() => provider.requests.length === 2);
  let received = false;
  const pending = adapter.deliver('Busy Pi input.\nRetain Unicode \u2028 safely.', 'pi-busy').then(() => { received = true; });
  await new Promise<void>(resolve => setTimeout(resolve, 200)); assert.equal(received, false);
  const captured = await adapter.turnControl.activeTurn(); assert(captured);
  await adapter.turnControl.interrupt(captured);
  provider.release();
  await pending;
  await until(() => provider.requests.length >= 3);
  await adapter.deliver('Busy Pi input.\nRetain Unicode \u2028 safely.', 'pi-busy');
  const history = readFileSync(String(state.sessionFile), 'utf8');
  assert.equal(history.split('\n').filter(line => line.includes('"messageId":"pi-busy"')).length, 1);
  assert.equal(history.split('\n').filter(line => line.includes('"messageId":"pi-idle"')).length, 1);
  adapter.acknowledge(['pi-idle', 'pi-busy']);
  await adapter.close();
  const matrix = await matrixFixture(scope, directory);
  matrix.subscribe(ROOM);
  const receiverStop = new AbortController();
  const runtime: RuntimeAdapter = (signal, pollMs) => connectPi(parsed.value, journal, pollMs, signal);
  let ended = false;
  const receiver = listen({ ...matrix, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 2, runtime }, receiverStop.signal)
    .catch(error => error).finally(() => { ended = true; });
  scope.after(async () => { receiverStop.abort(); await receiver; });
  await until(() => matrix.waiting() > 0 && existsSync(matrix.cursorFile)
    && readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '0');
  matrix.add(ROOM, ...Array.from({ length: 5 }, (_, index) => message('$pi-matrix-' + index, undefined, 'Matrix burst ' + index)));
  await until(() => existsSync(matrix.cursorFile) && readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '5');
  const deliveredHistory = readFileSync(String(state.sessionFile), 'utf8');
  for (let index = 0; index < 5; index++) assert.equal(deliveredHistory.split('\n').filter(line => line.includes('$pi-matrix-' + index) && line.includes('"customType":"crossfire"')).length, 1);
  await assert.rejects(connectPi(parsed.value, journal, 100, stop.signal), /already owns/);
  await command('new_session');
  await until(() => ended, 'Session replacement must stop its existing Matrix receiver');
  assert(await receiver instanceof Error);
  await assert.rejects(connectPi(parsed.value, journal, 100, stop.signal), /unavailable|rejected|closed/iu);
  child.stdin.end(); child.kill('SIGTERM'); await once(child, 'exit');
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ errors, records, requests: provider.requests }, null, 2));
});
