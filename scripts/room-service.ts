import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, elementConfig, type InstanceConfig } from './instance.ts';
import { CLIENT_PATH, INSTALLER_PATH, type ClientFiles } from './onboarding.ts';
import type { RuntimeInfo } from './version.ts';
import { API, Matrix, MatrixError, readJson, segment, localUser, powerLevels, collect, ensureObserver,
  type Settings, type Members, type Event } from '../skills/conduit-chat/scripts/lib.ts';

export function serve(config: InstanceConfig, settings: Settings, matrix: Matrix, privatePath: string,
  startup: Omit<RuntimeInfo, 'client_sha256'>): ReturnType<typeof createServer> {
  const instance = config.id;
  const clientFiles = readJson<ClientFiles>(join(privatePath, 'client-files.json'));
  const installer = readFileSync(join(privatePath, 'install.mjs'));
  const runtime: RuntimeInfo = { ...startup, client_sha256: createHash('sha256').update(clientFiles['scripts/chat.mjs']).digest('hex') };
  const webRoot = resolve(process.env.CROSSFIRE_WEB_ROOT ?? join(ROOT, 'web'));
  let roomQueue: Promise<void> = Promise.resolve();

  async function conversation(token: string, target: string): Promise<{ room_id: string; participants: string[]; observer: string }> {
    const caller = new Matrix(settings.homeserver, token);
    const sender = (await caller.get<{ user_id: string }>(API + '/account/whoami')).user_id;
    const recipient = localUser(target, settings);
    const roster: Members = {};
    for (const room of settings.rooms) Object.assign(roster, await ensureObserver(matrix, room.room_id, settings));
    if (!(sender in roster) || !(recipient in roster)) throw new Error('Both participants must first join a configured shared room in this instance');
    if (sender === recipient) throw new Error('Choose another participant');
    const peers = [...new Set([sender, recipient, settings.observer])].sort();
    const pair = [sender, recipient].filter(user => user !== settings.observer).sort();
    const aliasName = 'conversation-' + createHash('sha256').update(pair.join('\n')).digest('hex').slice(0, 32);
    const alias = `#${aliasName}:${settings.server_name}`;
    let room: string;
    try { room = (await matrix.get<{ room_id: string }>(`${API}/directory/room/${segment(alias)}`)).room_id; }
    catch (error) {
      if (!(error instanceof MatrixError) || error.status !== 404) throw error;
      const names = pair.map(user => roster[user].display_name ?? user.slice(1).split(':')[0]);
      room = (await matrix.post<{ room_id: string }>(API + '/createRoom', {
        room_alias_name: aliasName, name: names.join(' ↔ ') + ' + ' + settings.observer_label,
        topic: 'Direct coordination. The administrator is a permanent participant.',
        visibility: 'private', preset: 'private_chat', is_direct: false, room_version: '12',
        creation_content: { 'm.federate': false }, power_level_content_override: powerLevels(),
        initial_state: [
          { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'shared' } },
          { type: 'local.conduit.participants', state_key: '', content: { users: peers } },
        ], invite: peers.filter(user => user !== settings.observer),
      })).room_id;
    }
    const base = `${API}/rooms/${segment(room)}`;
    const joined = (await matrix.get<{ joined: Members }>(base + '/joined_members')).joined;
    if (!(settings.observer in joined)) throw new Error('Observer missing; refusing this conversation');
    const marker = await matrix.get(base + '/state/local.conduit.participants');
    if (!isDeepStrictEqual(marker, { users: peers }) || Object.keys(joined).some(user => !peers.includes(user))) {
      throw new Error('Room participants do not match this conversation');
    }
    const creation = (await matrix.get<Event[]>(base + '/state')).find(event => event.type === 'm.room.create');
    if (!creation || creation.sender !== settings.observer || creation.content.room_version !== '12'
        || (Array.isArray(creation.content.additional_creators) && creation.content.additional_creators.length > 0)) {
      throw new Error('Observer must be the sole room creator');
    }
    const levels = await matrix.get(base + '/state/m.room.power_levels');
    for (const [key, expected] of Object.entries(powerLevels())) {
      if (!isDeepStrictEqual(levels[key] ?? (key === 'users' || key === 'events' ? {} : undefined), expected)) {
        throw new Error('Room permissions changed; administrator review required');
      }
    }
    for (const peer of peers) if (!(peer in joined)) await matrix.post(base + '/invite', { user_id: peer });
    await caller.post(`${API}/join/${segment(room)}`, {});
    return { room_id: room, participants: peers, observer: settings.observer };
  }

  function json(response: ServerResponse, status: number, value: unknown): void {
    const bytes = Buffer.from(JSON.stringify(value));
    response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    response.end(bytes);
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && pathname === '/_coord/health') {
      json(response, 200, { instance, status: 'ready', run_id: process.env.CROSSFIRE_RUN_ID, ...runtime });
      return;
    }
    if (request.method === 'GET' && pathname === INSTALLER_PATH) {
      response.writeHead(200, { 'Content-Type': 'application/javascript', 'Content-Length': installer.length, 'Cache-Control': 'no-store' });
      response.end(installer);
      return;
    }
    if (request.method === 'GET' && pathname === CLIENT_PATH) {
      const supplied = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from('Bearer ' + settings.registration_token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        json(response, 401, { error: 'Use the enrollment instructions printed by the server owner' }); return;
      }
      json(response, 200, { format: 3, settings, files: clientFiles });
      return;
    }
    if (request.method === 'GET' && pathname === '/_coord/rooms') {
      const auth = request.headers.authorization ?? '';
      if (!auth.startsWith('Bearer ') || auth.length <= 7) { json(response, 401, { error: 'Matrix access token required' }); return; }
      await new Matrix(settings.homeserver, auth.slice(7)).get(API + '/account/whoami');
      json(response, 200, { default_room: settings.default_room, rooms: settings.rooms });
      return;
    }
    if (request.method === 'POST' && pathname === '/_coord/dm') {
      const auth = request.headers.authorization ?? '';
      if (!auth.startsWith('Bearer ') || auth.length <= 7) { json(response, 401, { error: 'Matrix access token required' }); return; }
      const body: unknown = JSON.parse((await collect(request, 4096)).toString());
      if (!body || typeof body !== 'object' || !('recipient' in body) || typeof body.recipient !== 'string') throw new Error('recipient must be a local Matrix user ID');
      const recipient = body.recipient;
      const operation = roomQueue.then(() => conversation(auth.slice(7), recipient));
      roomQueue = operation.then(() => undefined, () => undefined);
      json(response, 200, await operation);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { error: 'Unsupported method' }); return; }
    if (pathname === '/config.json') { json(response, 200, elementConfig(config)); return; }
    let path: string;
    try {
      path = await realpath(resolve(webRoot, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
      if (!path.startsWith(webRoot + sep)) { json(response, 404, { error: 'Not found' }); return; }
    } catch { json(response, 404, { error: 'Not found' }); return; }
    const info = await stat(path);
    if (!info.isFile()) { json(response, 404, { error: 'Not found' }); return; }
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
      '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain',
    };
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Length': info.size,
      'Cache-Control': path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(path);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    }
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      if (error instanceof MatrixError) json(response, error.status, error.body);
      else json(response, 400, { error: error instanceof Error ? error.message : 'Request failed' });
    });
  });
  server.requestTimeout = 60_000;
  server.listen(config.web_port, '0.0.0.0', () => {
    console.log(`Crossfire ${instance}: http://127.0.0.1:${config.web_port}`);
    console.log(`Version: ${runtime.build.version} | Revision: ${runtime.build.revision.slice(0, 12)}${runtime.build.modified ? ' (modified)' : ''}`);
    console.log(`Started: ${runtime.started_at} | Node: ${runtime.node}`);
    console.log(`Client SHA-256: ${runtime.client_sha256}`);
  });
  return server;
}
