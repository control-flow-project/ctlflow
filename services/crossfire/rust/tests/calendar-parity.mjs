import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createScheduleCalculator } from '@ctlflow/crossfire-adapter-schedule/create-calculator';

const [binary] = process.argv.slice(2);
assert(binary && process.argv.length === 3 && binary.startsWith('/'), 'One compiled native calendar executable is required');
const calculator = createScheduleCalculator(), cases = [];
const expressions = ['* * * * *', '*/15 * * * *', '7,23,59 0,12,23 * * *', '30 2 * * *', '0 1 * * *', '30 1 * * *',
  '0 9 * * MON-FRI', '0 0 29 2 *', '0 0 L * *', '15 6 * * 5L', '0 0 * * 1#2', '0 0 1,15 * SUN', '0 0 ? JAN,MAR,DEC 0,6',
  '0 0 */5 * *', '*/20 1-23/4 * * *', '0 0 * * 7', '0 0 * * 0-7', '0 0 31 4 *', '60 * * * *', '0 0 1 0 *',
  '0 0 * * 1#6', '0 0 * * 5,5', '0 0 1,1 * *', 'H * * * *', '0 0 * * 5l', '0 0 l * *', '0 0 * * MONL', '0 0 * * 0,7'];
const times = ['2026-01-01T00:00:00.000Z', '2026-03-08T06:00:00Z', '2026-03-08T07:15:00Z', '2026-03-29T00:00:00Z',
  '2026-10-25T00:00:00Z', '2026-11-01T05:00:00Z', '2026-11-01T05:45:00Z', '2026-11-01T06:15:00Z',
  '2011-12-29T20:00:00Z', '2024-02-28T23:59:59.999Z', '2026-10-03T14:30:00Z', '2026-04-04T14:30:00Z'];
const zones = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Pacific/Apia'];
function add(schedule, after) {
  const result = calculator.next(schedule, after);
  cases.push({ schedule, after, expected: result.ok ? result.value : null });
}
for (const expression of expressions) for (const timeZone of zones) for (const time of times) {
  add({ kind: 'cron', expression, timeZone }, Date.parse(time));
}
for (const expression of ['0 0 * * *', '0 0 0 * * *', '', '? ? ? ? ?', '0 0 * * 0#5', '0 0 L/2 * *']) {
  for (const timeZone of ['Etc/GMT+5', 'America/No_Such_Zone', 'GMT', 'utc', 'Asia/Calcutta', 'Europe/Berlin']) {
    add({ kind: 'cron', expression, timeZone }, Date.parse('2026-01-01T00:00:00Z'));
  }
}
for (const seconds of [0, 1, 60, 31_536_000, 31_536_001]) for (const after of [0, 1_700_000_000_123, Number.MAX_SAFE_INTEGER - 1000, -1]) {
  add({ kind: 'interval', seconds }, after);
}
const input = JSON.stringify(cases);
assert(Buffer.byteLength(input) <= 8_388_608, 'Calendar corpus exceeds the native fixture bound');
const started = performance.now();
const output = await new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let captured = '';
  const deadline = setTimeout(() => child.kill('SIGKILL'), 60_000);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  const receive = chunk => { captured = (captured + chunk).slice(-262_144); };
  child.stdout.on('data', receive); child.stderr.on('data', receive);
  child.once('error', error => { clearTimeout(deadline); reject(error); });
  child.stdin.on('error', error => { child.kill('SIGKILL'); clearTimeout(deadline); reject(error); });
  child.once('close', (code, signal) => {
    clearTimeout(deadline);
    if (code !== 0) reject(new Error(`Native calendar parity failed (${signal ?? code})\n${captured}`));
    else resolve(captured);
  });
  child.stdin.end(input);
});
const result = JSON.parse(output);
assert.equal(result.status, 'passed'); assert.equal(result.cases, cases.length);
console.log(JSON.stringify({ status: 'passed', cases: cases.length, milliseconds: Math.round(performance.now() - started), scope: 'native Rust and canonical Node calendar outcomes' }));
