#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { API, CONFIG, STATE, Matrix, name, readJson, readSettings, selectRoom, writeJson, emit, acquireProcessLock,
  register, segment, localUser, ensureObserver, type Account, type Settings } from './lib.ts';
import { readUnread, sharedRooms, enrollRooms, synchronize, loadSyncCursor, checkpointSync, membershipResets, retainJoinedCursors, acknowledge, flushAcknowledgements, inbox, projectMessages, type Sync } from './receive.ts';
import { listen } from './listen.ts';
import { operations, option, selectOperation, executeOperation, operationOptions, type Arguments } from './matrix-api.ts';
import { kebab } from './matrix-schema.ts';
import { DEFAULT_EVENTS, MAX_EVENTS, integerOption, outputBytes } from './limits.ts';
import { requireNode } from '../../../scripts/version.ts';

const globals = ['instance', 'agent', 'max-output-bytes'];
const bodyOptions = ['body', 'body-file', 'markdown', 'markdown-file', 'input-file', 'output-file', 'content-type', 'view'];
const localOptions: Record<string, readonly string[]> = {
  init: ['limit'], read: ['room', 'limit'], conversation: ['recipient'],
  listen: ['room', 'limit', 'thread', 'codex-socket', 'codex-binary', 'poll-ms', 'request-timeout-ms', 'debounce-ms'],
};

async function acquire(client: Matrix, settings: Settings, account: Account, cursorFile: string) {
  const since = loadSyncCursor(cursorFile);
  const synced = await synchronize(client, settings, account, since);
  const reset = await membershipResets(client, synced, account, since);
  const joined = (await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms;
  retainJoinedCursors(cursorFile, new Set(joined.filter(room => !reset.has(room))));
  checkpointSync(cursorFile, synced.next_batch);
  return synced;
}

async function main(): Promise<void> {
  requireNode();
  const options: Record<string, { type: 'string' | 'boolean'; multiple?: boolean }> = { help: { type: 'boolean' } };
  for (const key of [...globals, ...bodyOptions, ...Object.values(localOptions).flat(), ...operations.flatMap(operation => operation.parameters.map(parameter => kebab(parameter.name)))]) {
    options[key] = { type: 'string', multiple: true };
  }
  const parsed = parseArgs({ allowPositionals: true, options });
  const values = parsed.values as Arguments;
  const [group, command] = parsed.positionals;
  if (parsed.positionals.length > 2) throw new Error('Expected one namespace and one command');
  const maximum = outputBytes(option(values, 'max-output-bytes'));
  if (values.help) {
    if (group === 'matrix' && command) emit(selectOperation(command), maximum);
    else if (group === 'matrix') emit({ namespace: 'matrix', schema: 'v1.12', operations: operations.map(operation => ({ command: operation.command, access: operation.access })) }, maximum);
    else emit({ usage: 'chat --instance NAME --agent NAME agent|matrix COMMAND', agent: localOptions,
      matrix: 'Official Matrix operation IDs and parameter names converted to kebab-case. Use matrix OPERATION --help.',
      output: '64 KiB default; --max-output-bytes 1024..98304. Native response fields and tokens are preserved.' }, maximum);
    return;
  }
  if (group !== 'agent' && group !== 'matrix') throw new Error('Use agent or matrix; superseded top-level commands are not supported');
  const operation = group === 'matrix' ? selectOperation(command ?? '') : undefined;
  if (!operation && !(command in localOptions)) throw new Error('Unknown agent command; use --help');
  const allowed = new Set([...globals, ...(operation ? operationOptions(operation) : localOptions[command])]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new Error('Unsupported option --' + key + ' for ' + command);
  const listener = group === 'agent' && command === 'listen' ? {
    thread: option(values, 'thread'),
    pollMs: integerOption(option(values, 'poll-ms'), 10000, 100, 30000, '--poll-ms'),
    debounceMs: integerOption(option(values, 'debounce-ms'), 10000, 0, 60000, '--debounce-ms'),
    timeoutMs: integerOption(option(values, 'request-timeout-ms'), 30000, 100, 300000, '--request-timeout-ms'),
  } : undefined;
  if (listener && !listener.thread) throw new Error('listen requires --thread');
  const instance = name(option(values, 'instance') ?? ''), agent = name(option(values, 'agent') ?? '');
  const settings = readSettings(join(CONFIG, 'instances', instance + '.json'));
  if (settings.instance !== instance) throw new Error('Instance configuration identity mismatch');
  const profile = join(CONFIG, 'accounts', instance, agent + '.json');
  const state = join(STATE, instance, agent), cursorFile = join(state, 'cursors.json');
  const receiverOwned = group === 'agent' && ['init', 'read', 'listen'].includes(command)
    || operation && ['setReadMarker', 'postReceipt'].includes(operation.id);
  const release = receiverOwned ? await acquireProcessLock(join(state, 'client'), 0) : undefined;
  try {
    if (group === 'agent' && command === 'init') {
      const account = existsSync(profile) ? readJson<Account>(profile)
        : { ...await register(settings, 'agent-' + agent, randomBytes(32).toString('base64url'), agent), workspace: process.cwd() };
      writeJson(profile, account);
      const client = new Matrix(settings.homeserver, account.access_token);
      await flushAcknowledgements(client, cursorFile);
      await sharedRooms(client, settings);
      if (!account.announcement_room_id) {
        await enrollRooms(client, settings);
        await client.put(`${API}/profile/${segment(account.user_id)}/displayname`, { displayname: agent });
        const room = selectRoom(settings);
        await ensureObserver(client, room, settings);
        await client.put(`${API}/rooms/${segment(room)}/send/m.room.message/enrolled-${agent}`, {
          msgtype: 'm.notice', body: `${agent} connected.\nWorkspace: ${account.workspace}`,
        });
        account.announcement_room_id = room;
        writeJson(profile, account);
      }
      const synced = await acquire(client, settings, account, cursorFile);
      const batch = await readUnread(client, settings, cursorFile, integerOption(option(values, 'limit'), DEFAULT_EVENTS, 1, MAX_EVENTS, '--limit'),
        undefined, maximum, synced.next_batch);
      emit({ instance, agent, user_id: account.user_id, default_room: settings.default_room, rooms: settings.rooms,
        events: batch.events, more: batch.more_rooms.length > 0 }, maximum);
      await acknowledge(client, cursorFile, batch);
      return;
    }
    const account = readJson<Account>(profile);
    if (group === 'agent' && command === 'listen') {
      const thread = listener!.thread;
      if (!thread || !account.workspace) throw new Error('listen requires --thread and an identity enrolled from its workspace');
      const controller = new AbortController(), cancel = () => controller.abort(new Error('Listener stopped'));
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
      for (const signal of signals) process.on(signal, cancel);
      try {
        await listen({ settings, account, cursorFile, maximumBytes: maximum,
          limit: integerOption(option(values, 'limit'), DEFAULT_EVENTS, 1, MAX_EVENTS, '--limit'), room: option(values, 'room'),
          pollMs: listener!.pollMs, debounceMs: listener!.debounceMs,
          codex: { thread, workspace: account.workspace, socket: option(values, 'codex-socket'), binary: option(values, 'codex-binary'),
            timeoutMs: listener!.timeoutMs } }, controller.signal);
      } catch (error) { if (!controller.signal.aborted) throw error; }
      finally { for (const signal of signals) process.removeListener(signal, cancel); }
      return;
    }
    const client = new Matrix(settings.homeserver, account.access_token);
    if (operation) {
      const view = option(values, 'view');
      if (view && !['messages', 'inbox'].includes(view)) throw new Error('Unknown output view');
      if (view === 'inbox' && operation.id !== 'sync') throw new Error('--view inbox requires matrix sync');
      if (view && option(values, 'output-file')) throw new Error('File output preserves the native response; do not combine it with --view');
      const result = await executeOperation(client, settings, account, operation, values);
      emit(view === 'inbox' ? inbox(result as Sync) : view === 'messages' ? projectMessages(result) : result, maximum);
    } else if (command === 'conversation') {
      const recipient = option(values, 'recipient');
      if (!recipient) throw new Error('--recipient is required');
      const broker = new Matrix(settings.room_service, account.access_token);
      const result = await broker.post<{ room_id: string }>('/_coord/dm', { recipient: localUser(recipient, settings) });
      await ensureObserver(client, result.room_id, settings);
      emit(result, maximum);
    } else {
      await flushAcknowledgements(client, cursorFile);
      await sharedRooms(client, settings);
      const synced = await acquire(client, settings, account, cursorFile);
      const batch = await readUnread(client, settings, cursorFile, integerOption(option(values, 'limit'), DEFAULT_EVENTS, 1, MAX_EVENTS, '--limit'),
        option(values, 'room'), maximum, synced.next_batch);
      emit({ instance, agent, events: batch.events, more: batch.more_rooms.length > 0, more_rooms: batch.more_rooms }, maximum);
      await acknowledge(client, cursorFile, batch);
    }
  } finally { await release?.(); }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Chat command failed'); process.exitCode = 1; });
