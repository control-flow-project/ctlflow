// Standalone installer: this file can travel with an exported client.json.
import { parseArgs } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { requireNode } from './version.ts';

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

async function readBundle(source?: string): Promise<Bundle> {
  if (!source?.startsWith('http:') && !source?.startsWith('https:')) {
    return JSON.parse(readFileSync(source ?? 0, 'utf8')) as Bundle;
  }
  const url = new URL(source);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
      || url.search || url.pathname !== '/_coord/client' || !/^#[A-Za-z0-9_-]{32,256}$/.test(url.hash)) {
    throw new Error('Use the complete loopback enrollment URL printed by the server');
  }
  const token = url.hash.slice(1);
  url.hash = '';
  const bytes = await new Promise<Buffer>((resolveBundle, reject) => {
    // Direct loopback HTTP, with no proxy environment or redirect following.
    const req = request(url, { headers: { Authorization: 'Bearer ' + token } }, response => {
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`Client enrollment failed (HTTP ${response.statusCode}); obtain current instructions from the server owner`)); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) { response.destroy(new Error('Client bundle exceeds 8 MiB')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolveBundle(Buffer.concat(chunks)));
    });
    req.setTimeout(15_000, () => req.destroy(new Error('Local enrollment server timed out')));
    req.on('error', reject);
    req.end();
  });
  return JSON.parse(bytes.toString()) as Bundle;
}

async function main(): Promise<void> {
  requireNode();
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
    'skill-dir': { type: 'string' }, 'config-dir': { type: 'string' },
    'state-dir': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node install.mts CLIENT_JSON_OR_ENROLLMENT_URL [--skill-dir PATH] [--config-dir PATH] [--state-dir PATH]');
    return;
  }
  if (positionals.length > 1) throw new Error('Supply one client bundle path');
  const bundle = await readBundle(positionals[0]);
  if (bundle.format !== 3 || !/^[a-z][a-z0-9-]{0,39}$/.test(bundle.settings?.instance)
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
    chat: join(skill, 'scripts/chat.mjs'), config_dir: config, state_dir: state, node: process.execPath,
    node_version: process.versions.node, client_sha256: createHash('sha256').update(bundle.files['scripts/chat.mjs']).digest('hex') }, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Client installation failed'); process.exitCode = 1; });
