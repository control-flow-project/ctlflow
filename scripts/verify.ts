import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { INSTANCES, ROOT } from './instance.ts';
import { API, Matrix, readJson, readSettings, segment, type Account, type Event } from '../skills/conduit-chat/scripts/lib.ts';

const { values } = parseArgs({ options: {
  instance: { type: 'string' }, secondary: { type: 'string' }, 'skill-dir': { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help || !values.instance || !values.secondary) {
  console.log('Usage: node scripts/verify.ts --instance FIRST --secondary SECOND [--skill-dir PATH]\n'
    + 'Both instances must be running and installed for the client account.\n'
    + 'Creates named verification accounts, rooms, files, and messages. Does not start agents.');
  process.exit(values.help ? 0 : 1);
}
assert.notEqual(values.instance, values.secondary, 'Verification needs two distinct instances');

const input = { ...values, skill: resolve(values['skill-dir'] ?? process.env.CROSSFIRE_SKILL_DIR
  ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills/conduit-chat')),
  library: new URL('../skills/conduit-chat/scripts/lib.ts', import.meta.url).href };
const result = spawnSync(process.execPath, [join(ROOT, 'scripts/verify-client.mjs')],
  { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || 'Client verification failed');
const report = JSON.parse(result.stdout) as { room: string; dmEvent: string; fileEvent: string; checks: string[] };

for (const instance of [values.instance, values.secondary]) {
  const settings = readSettings(join(INSTANCES, instance, 'private/settings.json'));
  const web = new Matrix(settings.room_service);
  const configured = await web.get<{ default_server_config: { 'm.homeserver': { base_url: string } } }>('/config.json');
  assert.equal(configured.default_server_config['m.homeserver'].base_url, settings.homeserver);
  const html = await (await fetch(settings.room_service)).text();
  assert(html.includes('matrixchat'));
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert(scripts.length > 0);
  for (const script of scripts) {
    const url = new URL(script, settings.room_service);
    assert.equal(url.origin, settings.room_service);
    const response = await fetch(url, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
  }
}
const settings = readSettings(join(INSTANCES, values.instance, 'private/settings.json'));
const observer = readJson<Account>(join(INSTANCES, values.instance, 'private/control-session.json'));
const admin = new Matrix(settings.homeserver, observer.access_token);
for (const event of [report.dmEvent, report.fileEvent]) {
  const visible = await admin.get<Event>(`${API}/rooms/${segment(report.room)}/event/${segment(event)}`);
  assert.equal(visible.event_id, event);
}
report.checks.push('observer can read DM and attachment events', 'per-instance UI config', 'HTML and JavaScript assets');
console.log(JSON.stringify(report, null, 2));
