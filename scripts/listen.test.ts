import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { API, writeJson } from '../skills/conduit-chat/scripts/lib.ts';
import { listen, type ListenerOptions } from '../skills/conduit-chat/scripts/listen.ts';
import { ROOT } from './instance.ts';
import { fakeCodex, matrixFixture, message, ROOM, SELF, THREAD, until } from './test-support/listener.ts';

const execute = promisify(execFile);

test('listener long-polls silently, wakes promptly, drains backlog, and checkpoints native acknowledgements', async t => {
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  const controller = new AbortController();
  const options: ListenerOptions = { ...matrix, limit: 2, pollMs: 100, codex: native.options };
  const result = listen(options, controller.signal).catch(error => error);
  t.after(async () => { controller.abort(new Error('test complete')); await result; });
  await until(() => matrix.waiting() === 1 && existsSync(matrix.cursorFile));
  const before = statSync(matrix.cursorFile).mtimeMs;
  await until(() => matrix.requests.filter(request => request.path === API + '/sync').length >= 4);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  assert.equal(statSync(matrix.cursorFile).mtimeMs, before);
  matrix.add(ROOM, message('$self', SELF), ...Array.from({ length: 7 }, (_, index) => message('$' + index)));
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '8');
  const inputs = native.requests().filter(request => request.method === 'turn/start');
  const ids = inputs.flatMap(request => {
    const input = request.params!.input as { text: string }[];
    const batch = JSON.parse(input[0].text.slice(input[0].text.indexOf('\n') + 1));
    return batch.events.map((event: { event_id: string }) => event.event_id);
  });
  assert.deepEqual(ids, Array.from({ length: 7 }, (_, index) => '$' + index));
  const polls = matrix.requests.filter(request => request.path === API + '/sync');
  assert(polls.some(request => request.query.get('timeout') === '100'));
  assert(polls.filter(request => request.query.get('timeout') === '0').length >= 4);
  assert(native.requests().every(request => !['thread/start', 'thread/resume', 'thread/fork'].includes(request.method ?? '')));
  controller.abort(new Error('test complete'));
  assert.match(String(await result), /test complete/);
});

test('failed and uncertain native deliveries leave cursors untouched and are never automatically retried', async t => {
  for (const mode of ['reject', 'disconnect', 'timeout', 'missing-turn']) {
    const native = await fakeCodex(t, { mode });
    const matrix = await matrixFixture(t, native.directory);
    matrix.add(ROOM, message('$one'));
    writeJson(matrix.cursorFile, { [ROOM]: '0' });
    await assert.rejects(listen({ ...matrix, limit: 50, pollMs: 100,
      codex: { ...native.options, timeoutMs: 500 } }, new AbortController().signal));
    assert.deepEqual(JSON.parse(readFileSync(matrix.cursorFile, 'utf8')), { [ROOM]: '0' });
    assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  }
});

test('an incoming message wakes a ten-second long poll without waiting for its timeout', async t => {
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  const controller = new AbortController();
  const result = listen({ ...matrix, limit: 50, pollMs: 10_000, codex: native.options }, controller.signal).catch(error => error);
  t.after(async () => { controller.abort(new Error('test complete')); await result; });
  await until(() => matrix.waiting() === 1);
  assert.equal(matrix.requests.filter(request => request.path === API + '/sync').at(-1)!.query.get('timeout'), '10000');
  matrix.add(ROOM, message('$wake'));
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('transient Matrix errors retry bounded reads, never replaying acknowledged native inputs', async t => {
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  matrix.failures.set(API + '/sync', [503, 429]);
  matrix.add(ROOM, message('$one'));
  const controller = new AbortController();
  const result = listen({ ...matrix, limit: 50, pollMs: 100, codex: native.options }, controller.signal).catch(error => error);
  t.after(async () => { controller.abort(); await result; });
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  matrix.failures.set(API + '/sync', [503, 503, 503, 503]);
  matrix.wake();
  assert.match(String(await result), /HTTP 503/);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('permanent Matrix errors, observer failures, and oversized messages stop without native delivery', async t => {
  for (const kind of ['authentication', 'observer', 'oversized']) {
    const native = await fakeCodex(t);
    const matrix = await matrixFixture(t, native.directory);
    if (kind === 'authentication') matrix.failures.set(API + '/sync', [401]);
    if (kind === 'observer') matrix.missingObserver.add(ROOM);
    matrix.add(ROOM, message('$one', undefined, kind === 'oversized' ? 'x'.repeat(128 * 1024) : 'normal'));
    await assert.rejects(listen({ ...matrix, limit: 50, pollMs: 100, codex: native.options }, new AbortController().signal),
      kind === 'authentication' ? /HTTP 401/ : kind === 'observer' ? /observer/ : /exceeds the 128 KiB/);
    assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
    assert.equal(existsSync(matrix.cursorFile), false);
  }
});

test('CLI runs independently, emits nothing on idle polls, rejects concurrent readers, and releases its lock on SIGTERM', async t => {
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  const base = [join(ROOT, 'skills/conduit-chat/scripts/chat.ts'), '--instance', 'test', '--agent', 'watson'];
  const args = [...base, 'listen', '--thread', THREAD, '--codex-binary', native.options.binary, '--poll-ms', '100'];
  const child = spawn(process.execPath, args, { env: matrix.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { errors += String(chunk); });
  const stopped = once(child, 'close');
  t.after(async () => { child.kill('SIGTERM'); await stopped; });
  await until(() => matrix.waiting() === 1, errors);
  for (const command of ['read', 'init']) {
    await assert.rejects(execute(process.execPath, [...base, command], { env: matrix.env }), /already being held/);
  }
  await assert.rejects(execute(process.execPath, args, { env: matrix.env }), /already being held/);
  const who = await execute(process.execPath, [...base, 'who'], { env: matrix.env });
  assert(JSON.parse(who.stdout).members[SELF]);
  matrix.add(ROOM, message('$one'));
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  await delay(110);
  assert.equal(output, ''); assert.equal(errors, '');
  child.kill('SIGTERM');
  assert.deepEqual(await stopped, [0, null]);
  const read = await execute(process.execPath, [...base, 'read'], { env: matrix.env });
  assert.deepEqual(JSON.parse(read.stdout).events, []);
});

test('CLI validates listener-only controls before network use', async () => {
  const base = [join(ROOT, 'skills/conduit-chat/scripts/chat.ts'), '--instance', 'test', '--agent', 'watson'];
  for (const args of [['read', '--thread', THREAD], ['listen'], ['listen', '--thread', THREAD, '--poll-ms', 'NaN'],
    ['listen', '--thread', THREAD, '--poll-ms', '0'], ['listen', '--thread', THREAD, '--poll-ms', '30001'],
    ['listen', '--thread', THREAD, '--request-timeout-ms', 'Infinity']]) {
    await assert.rejects(execute(process.execPath, [...base, ...args]), /Listener options|listen requires|must be/);
  }
});

test('the standalone bundle relays from a foreign project without node_modules', async t => {
  await execute(process.execPath, [join(ROOT, 'scripts/build-client.ts')]);
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  const script = join(native.directory, 'chat.mjs');
  copyFileSync(join(ROOT, 'dist/chat.mjs'), script);
  writeFileSync(join(native.directory, 'package.json'), '{"type":"commonjs"}');
  matrix.add(ROOM, message('$standalone'));
  const child = spawn(process.execPath, [script, '--instance', 'test', '--agent', 'watson', 'listen', '--thread', THREAD,
    '--codex-binary', native.options.binary], { env: matrix.env, cwd: native.directory, stdio: ['ignore', 'pipe', 'pipe'] });
  const stopped = once(child, 'close');
  let errors = '', output = '';
  child.stderr.on('data', chunk => { errors += String(chunk); });
  child.stdout.on('data', chunk => { output += String(chunk); });
  t.after(async () => { child.kill('SIGTERM'); await stopped; });
  await until(() => existsSync(matrix.cursorFile) || child.exitCode !== null);
  assert.equal(errors, ''); assert.equal(output, '');
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], '1');
  assert(!existsSync(join(native.directory, 'node_modules')));
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  child.kill('SIGTERM');
  assert.deepEqual(await stopped, [0, null]);
});
