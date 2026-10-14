import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarCases } from './calendar-cases.mjs';
import { verifyTestResources } from '../../../../scripts/test-resources.mjs';

const [native, managed, dotnet] = process.argv.slice(2);
assert(native && managed && dotnet && process.argv.length === 5, 'Both managed and NativeAOT outputs are mandatory');
verifyTestResources();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(join(root, '.temp'), { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(root, '.temp/calendar-parity-'));
const cases = calendarCases();

try {
  const file = join(directory, 'cases.json'); writeFileSync(file, JSON.stringify(cases), { mode: 0o600 });
  for (const [binary, prefix, label] of [[dotnet, [managed], 'managed'], [native, [], 'NativeAOT']]) {
    const started = performance.now();
    await new Promise((complete, reject) => {
      const child = spawn(binary, [...prefix, '--calendar', file], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-65536); });
      child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        if (code !== 0) { reject(new Error(label + ' calendar parity failed: ' + (signal ?? code) + '\n' + stdout + stderr)); return; }
        console.log(JSON.stringify({ label, cases: cases.length, elapsedMs: Math.round(performance.now() - started) })); complete();
      });
    });
  }
} finally { rmSync(directory, { recursive: true }); }
