import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';

const [binary] = process.argv.slice(2);
assert(binary && isAbsolute(binary), 'Use the compiled native journal proof');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-native-journal-')); chmodSync(directory, 0o700);
const file = join(directory, 'input.json');
const message = { text: 'native message 😀', messageId: 'message', published: true };
const native = (action, input) => execFileSync(binary, [action, file], { encoding: 'utf8', input, timeout: 10000, maxBuffer: 4096 });
let owner;
try {
  native('prepare', JSON.stringify(message));
  assert.deepEqual(JSON.parse(native('read')).pending, message);
  native('confirm');
  const confirmed = JSON.parse(native('read'));
  assert.equal(confirmed.pending, null); assert.equal(confirmed.confirmed[0].messageId, 'message');
  native('acknowledge');
  assert.deepEqual(JSON.parse(native('read')).confirmed, []);
  native('prepare', JSON.stringify(message)); native('confirm');
  assert.equal(JSON.parse(native('read')).confirmed[0].digest, createHash('sha256').update(message.text).digest('hex'));
  owner = spawn(binary, ['lock', file], { stdio: ['pipe', 'pipe', 'pipe'] });
  const ended = new Promise((resolve, reject) => { owner.once('close', resolve); owner.once('error', reject); });
  const timer = setTimeout(() => owner.kill('SIGKILL'), 10000);
  try {
    await new Promise((resolve, reject) => {
      let output = ''; owner.stdout.setEncoding('utf8');
      owner.stdout.on('data', text => { output += text; if (output === 'owned\n') resolve(); else if (output.length > 128) reject(new Error('Unexpected ownership response')); });
      owner.once('error', reject); void ended.then(() => { if (output !== 'owned\n') reject(new Error('Native owner ended before readiness')); });
    });
    assert.throws(() => native('prepare', JSON.stringify(message)), 'A second native writer cannot bypass journal ownership');
    // Native read-only inspection remains available while another process owns writes.
    assert.equal(JSON.parse(native('read')).confirmed[0].messageId, 'message');
    owner.stdin.end('x'); assert.equal(await ended, 0);
  } finally { clearTimeout(timer); owner.kill('SIGKILL'); await ended; }
  native('acknowledge');
  assert.deepEqual(JSON.parse(native('read')).confirmed, []);
  console.log(JSON.stringify({ status: 'passed', assertions: 9, scope: 'native delivery journal persistence, acknowledgment, read-only inspection and cross-process ownership' }));
} finally { owner?.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); }
