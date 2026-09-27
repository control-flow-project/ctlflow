// Standalone installer: this file can travel with an exported client.json.
import { parseArgs } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';

type Paths = { config_dir?: string; state_dir?: string; skill_dir?: string };
type Bundle = {
  format: number;
  settings: { instance: string; homeserver: string; room_service: string; [key: string]: unknown };
  files: Record<string, string>;
};

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
function privateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function main(): void {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'skill-dir': { type: 'string' }, 'config-dir': { type: 'string' },
    'state-dir': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node install.mts CLIENT_JSON [--skill-dir PATH] [--config-dir PATH] [--state-dir PATH]');
    return;
  }
  if (positionals.length > 1) throw new Error('Supply one client bundle path');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error('Node 22.18+ is required');
  const bundle = JSON.parse(readFileSync(positionals[0] ?? 0, 'utf8')) as Bundle;
  if (bundle.format !== 2 || !/^[a-z][a-z0-9-]{0,39}$/.test(bundle.settings?.instance)
      || bundle.settings.instance === 'admin') throw new Error('Invalid Crossfire client bundle');
  for (const base of [bundle.settings.homeserver, bundle.settings.room_service]) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/'
        || url.username || url.password || url.search || url.hash) throw new Error('Client endpoints must use loopback HTTP');
  }
  const expected = ['SKILL.md', 'scripts/chat', 'scripts/chat.mjs', 'scripts/package.json'];
  if (!bundle.files || Object.keys(bundle.files).sort().join('\n') !== [...expected].sort().join('\n')
      || expected.some(file => typeof bundle.files[file] !== 'string')) throw new Error('Client bundle has unexpected files');

  const skill = resolve(values['skill-dir'] ?? process.env.CROSSFIRE_SKILL_DIR
    ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills/conduit-chat'));
  const metadata = join(skill, 'scripts/.client-paths.json');
  const previous = existsSync(metadata) ? JSON.parse(readFileSync(metadata, 'utf8')) as Paths : {};
  const config = resolve(values['config-dir'] ?? process.env.CROSSFIRE_CLIENT_CONFIG_DIR ?? previous.config_dir
    ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'conduit-chat'));
  const state = resolve(values['state-dir'] ?? process.env.CROSSFIRE_CLIENT_STATE_DIR ?? previous.state_dir
    ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'conduit-chat'));
  for (const path of [skill, join(skill, 'scripts'), config, join(config, 'instances'), state]) privateDirectory(path);
  for (const file of expected) {
    mkdirSync(dirname(join(skill, file)), { recursive: true, mode: 0o700 });
    privateFile(join(skill, file), bundle.files[file]);
  }
  chmodSync(join(skill, 'scripts/chat'), 0o755);
  privateFile(metadata, JSON.stringify({ config_dir: config, state_dir: state }, null, 2) + '\n');
  privateFile(join(config, 'instances', bundle.settings.instance + '.json'), JSON.stringify(bundle.settings, null, 2) + '\n');
  console.log(JSON.stringify({ instance: bundle.settings.instance, skill_file: join(skill, 'SKILL.md'),
    chat: join(skill, 'scripts/chat.mjs'), config_dir: config, state_dir: state, node: process.execPath }, null, 2));
}
try { main(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Client installation failed'); process.exitCode = 1; }
