import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
function bounded(text, chunk) {
  const value = (text + chunk).slice(-262144);
  return value.charCodeAt(0) >= 0xdc00 && value.charCodeAt(0) <= 0xdfff ? value.slice(1) : value;
}
export function execute(command, arguments_, { environment = process.env, line, timeout = 300000, workingDirectory = repository } = {}) {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new Error('Supply a bounded positive command timeout');
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: workingDirectory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', buffered = '', timedOut = false, parseError = null, escalation;
    const stop = () => { child.kill('SIGTERM'); escalation ??= setTimeout(() => child.kill('SIGKILL'), 2000); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { errors = bounded(errors, chunk); });
    child.stdout.on('data', chunk => {
      output = bounded(output, chunk);
      if (!line || parseError) return;
      buffered += chunk;
      if (buffered.length > 2097152) { parseError = new Error('Compiler metadata exceeds its line resource bound'); stop(); return; }
      while (buffered.includes('\n')) {
        const newline = buffered.indexOf('\n'), text = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
        try { if (text.trim()) line(text); }
        catch (error) { parseError = error; stop(); return; }
      }
    });
    child.once('error', error => { clearTimeout(timer); clearTimeout(escalation); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(escalation);
      if (parseError) return reject(parseError);
      if (code !== 0 || timedOut) return reject(new Error(`${command} failed (${timedOut ? 'timeout' : code ?? signal})\nstdout:\n${output}\nstderr:\n${errors}`));
      if (line && buffered.trim()) {
        try { line(buffered); } catch (error) { reject(error); return; }
      }
      resolve(output);
    });
  });
}
