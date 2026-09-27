#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, statSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { API, CONFIG, STATE, Matrix, name, readJson, readSettings, roomCatalog, selectRoom, writeJson, emit, acquireProcessLock,
  register, segment, localUser, ensureObserver, collect,
  type Settings, type Account, type Event, type JsonObject } from './lib.ts';

type Page = { chunk: Event[]; end?: string };
type Invites = { rooms?: { invite?: Record<string, { invite_state: { events: Event[] } }> } };

async function acceptInvites(client: Matrix, settings: Settings, account: Account): Promise<void> {
  const result = await client.get<Invites>(API + '/sync', { timeout: 0, filter: JSON.stringify({
    room: { timeline: { limit: 0 }, state: { types: ['m.room.member'] },
      ephemeral: { types: [] }, account_data: { types: [] } },
  }) });
  for (const [room, invite] of Object.entries(result.rooms?.invite ?? {})) {
    if (invite.invite_state.events.some(event => event.type === 'm.room.member'
        && event.state_key === account.user_id && event.sender === settings.observer
        && event.content.membership === 'invite')) {
      await client.post(`${API}/join/${segment(room)}`, {});
      await ensureObserver(client, room, settings);
    }
  }
}

function eventView(event: Event, room: string) {
  return { room_id: room, event_id: event.event_id, sender: event.sender,
    type: event.type, content: event.content,
    timestamp: event.origin_server_ts === undefined ? undefined : new Date(event.origin_server_ts).toISOString() };
}

async function sharedRooms(client: Matrix, settings: Settings): Promise<void> {
  const catalog = roomCatalog(await new Matrix(settings.room_service, client.token).get('/_coord/rooms'));
  Object.assign(settings, catalog);
  const joined = new Set((await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms);
  for (const room of settings.rooms) {
    if (!joined.has(room.room_id)) await client.post(`${API}/join/${segment(room.room_id)}`, {});
    await ensureObserver(client, room.room_id, settings);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    instance: { type: 'string' }, agent: { type: 'string' }, room: { type: 'string' },
    to: { type: 'string' }, message: { type: 'string' }, 'message-file': { type: 'string' },
    caption: { type: 'string' }, txn: { type: 'string' }, limit: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('chat --instance NAME --agent NAME COMMAND\n'
      + 'init                                Join configured shared rooms and announce this identity\n'
      + 'read [--room ROOM] [--limit 1..100]    Read unread events and save cursors\n'
      + 'history [--room ROOM] [--limit 1..100] Read recent messages without moving cursors\n'
      + 'send --message TEXT [--to PEER|--room ROOM] [--txn ID]\n'
      + 'send --message-file FILE [--to PEER|--room ROOM] [--txn ID]\n'
      + 'upload FILE [--to PEER|--room ROOM] [--caption TEXT] [--txn ID]\n'
      + 'download MXC NEW_FILE');
    console.log('who [--room ROOM]                    List members of a shared room\n'
      + 'rooms                               List rooms, aliases, purposes, and members\n'
      + '--help                              Show this command list\n'
      + 'ROOM is a configured alias, full local alias, or Matrix room ID.\n'
      + 'PEER is an agent name, a local Matrix ID, or admin. Untargeted send/upload/history/who use default_room.');
    return;
  }
  const instance = name(values.instance ?? '');
  const agent = name(values.agent ?? '');
  const command = positionals[0];
  const validCommands = ['init', 'read', 'history', 'send', 'upload', 'download', 'who', 'rooms'];
  if (!validCommands.includes(command)) throw new Error('Unknown command. Use --help.');
  if (values.to && values.room) throw new Error('Choose --to or --room, not both');
  const limit = Number(values.limit ?? '50');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1..100');
  const settings = readSettings(join(CONFIG, 'instances', instance + '.json'));
  if (settings.instance !== instance) throw new Error('Instance configuration identity mismatch');
  const profile = join(CONFIG, 'accounts', instance, agent + '.json');
  const state = join(STATE, instance, agent);
  const release = command === 'init' || command === 'read' ? await acquireProcessLock(join(state, 'client')) : undefined;
  try {

  if (command === 'init') {
    let account: Account;
    if (existsSync(profile)) account = readJson<Account>(profile);
    else {
      account = await register(settings, 'agent-' + agent, randomBytes(32).toString('base64url'), agent);
      account.workspace = process.cwd();
      writeJson(profile, account);
    }
    const client = new Matrix(settings.homeserver, account.access_token);
    await client.put(`${API}/profile/${segment(account.user_id)}/displayname`, { displayname: agent });
    await sharedRooms(client, settings);
    account.announcement_room_id ??= selectRoom(settings);
    writeJson(profile, account);
    await ensureObserver(client, account.announcement_room_id, settings);
    await client.put(`${API}/rooms/${segment(account.announcement_room_id)}/send/m.room.message/enrolled-${agent}`, {
      msgtype: 'm.notice', body: `${agent} connected.\nWorkspace: ${account.workspace}`,
    });
    emit({ instance, agent, user_id: account.user_id, default_room: settings.default_room, rooms: settings.rooms });
    return;
  }

  const account = readJson<Account>(profile);
  const client = new Matrix(settings.homeserver, account.access_token);
  await sharedRooms(client, settings);
  if (command === 'read') {
    await acceptInvites(client, settings, account);
    const rooms = values.room ? [selectRoom(settings, values.room)] : (await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms;
    const cursorFile = join(state, 'cursors.json');
    const cursors = existsSync(cursorFile) ? readJson<Record<string, string>>(cursorFile) : {};
    const events: ReturnType<typeof eventView>[] = [];
    const moreRooms: string[] = [];
    for (const room of rooms.sort()) {
      await ensureObserver(client, room, settings);
      const query: Record<string, string | number> = { dir: 'f', limit };
      if (cursors[room]) query.from = cursors[room];
      const page = await client.get<Page>(`${API}/rooms/${segment(room)}/messages`, query);
      if (page.end) cursors[room] = page.end;
      if (page.chunk.length >= limit) moreRooms.push(room);
      for (const event of page.chunk) {
        if (['m.room.message', 'm.room.encrypted', 'm.room.redaction'].includes(event.type)) events.push(eventView(event, room));
      }
    }
    // Keep the server's timeline order within each room. Timestamps can tie,
    // and event IDs are identifiers, not chronological sort keys.
    emit({ instance, agent, events, more: moreRooms.length > 0, more_rooms: moreRooms });
    writeJson(cursorFile, cursors);
  } else if (command === 'history') {
    const room = selectRoom(settings, values.room);
    await ensureObserver(client, room, settings);
    const page = await client.get<Page>(`${API}/rooms/${segment(room)}/messages`, { dir: 'b', limit });
    emit({ instance, room_id: room, events: page.chunk.reverse().filter(e => e.type === 'm.room.message').map(e => eventView(e, room)) });
  } else if (command === 'send' || command === 'upload') {
    let room = selectRoom(settings, values.room);
    if (values.to) {
      const broker = new Matrix(settings.room_service, account.access_token);
      room = (await broker.post<{ room_id: string }>('/_coord/dm', { recipient: localUser(values.to, settings) })).room_id;
    }
    await ensureObserver(client, room, settings);
    let content: JsonObject;
    let sha256: string | undefined;
    if (command === 'send') {
      if ((values.message === undefined) === (values['message-file'] === undefined)) throw new Error('Supply exactly one of --message or --message-file');
      const body = values['message-file'] ? readFileSync(values['message-file'], 'utf8') : values.message!;
      if (Buffer.byteLength(body) < 1 || Buffer.byteLength(body) > 50_000) throw new Error('Send 1..50000 bytes of text; upload larger documents');
      content = { msgtype: 'm.text', body };
    } else {
      const file = positionals[1];
      if (!file) throw new Error('upload requires a file path');
      const size = statSync(file).size;
      if (size > settings.max_upload_bytes) throw new Error('File exceeds this instance\'s upload limit');
      const bytes = readFileSync(file);
      if (bytes.length !== size) throw new Error('File changed while being read');
      const types: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.zip': 'application/zip' };
      const mime = types[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const response = await client.open('POST', '/_matrix/media/v3/upload?filename=' + segment(basename(file)), bytes, mime);
      const upload = JSON.parse((await collect(response, 65536)).toString()) as { content_uri: string };
      content = { msgtype: 'm.file', body: values.caption ?? basename(file), filename: basename(file),
        url: upload.content_uri, info: { size, mimetype: mime } };
      sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    const txn = values.txn ?? randomUUID();
    try {
      const result = await client.put<{ event_id: string }>(`${API}/rooms/${segment(room)}/send/m.room.message/${segment(txn)}`, content);
      emit({ instance, room_id: room, event_id: result.event_id, txn, mxc: content.url, sha256 });
    } catch (error) {
      console.error('For a retry preserve the transaction id: --txn ' + txn);
      throw error;
    }
  } else if (command === 'download') {
    const [mxc, destination] = positionals.slice(1);
    if (!mxc || !destination) throw new Error('download requires MXC and a new destination path');
    const uri = new URL(mxc);
    const mediaId = uri.pathname.slice(1);
    if (uri.protocol !== 'mxc:' || uri.host !== settings.server_name || !mediaId || mediaId.includes('/') || uri.search || uri.hash) {
      throw new Error('Expected a file URI from the selected instance');
    }
    const response = await client.open('GET', `/_matrix/client/v1/media/download/${segment(uri.host)}/${segment(mediaId)}`);
    let fd: number;
    try { fd = openSync(destination, 'wx', 0o600); }
    catch (error) { response.destroy(); throw error; }
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of response as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > settings.max_upload_bytes) throw new Error('Download exceeds the instance limit');
        let offset = 0;
        while (offset < chunk.length) offset += writeSync(fd, chunk, offset);
        hash.update(chunk);
      }
    } catch (error) { unlinkSync(destination); throw error; }
    finally { closeSync(fd); }
    emit({ instance, path: resolve(destination), bytes: size, sha256: hash.digest('hex') });
  } else if (command === 'who') {
    const room = selectRoom(settings, values.room);
    emit({ instance, room_id: room, members: await ensureObserver(client, room, settings) });
  } else {
    await acceptInvites(client, settings, account);
    const rooms = [];
    for (const room of (await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms) {
      const members = await ensureObserver(client, room, settings);
      const title = await client.get<{ name: string }>(`${API}/rooms/${segment(room)}/state/m.room.name`);
      const topic = await client.get<{ topic?: string }>(`${API}/rooms/${segment(room)}/state/m.room.topic`).catch(error => {
        if (error instanceof Error && 'status' in error && error.status === 404) return { topic: '' };
        throw error;
      });
      const configured = settings.rooms.find(entry => entry.room_id === room);
      rooms.push({ room_id: room, alias: configured?.alias, name: title.name, purpose: topic.topic ?? '',
        configured: !!configured, default: configured?.alias === settings.default_room, members: Object.keys(members) });
    }
    emit({ instance, default_room: settings.default_room, rooms });
  }
  } finally { await release?.(); }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Chat command failed'); process.exitCode = 1; });
