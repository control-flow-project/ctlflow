import { localState as storage } from '@crossfire/adapter-filesystem/state';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { parseArgs } from "node:util";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { spawn } from 'node:child_process';
import { matrix } from '@crossfire/adapter-matrix/http';
import { paths, readProfile } from '@crossfire/adapter-filesystem/project';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
import { emit } from './output.js';
import { operations, option, selectOperation, executeOperation, operationOptions, type Arguments } from "@crossfire/adapter-matrix/commands";
import { DEFAULT_EVENTS, MAX_EVENTS, integerOption, outputBytes } from "@crossfire/contracts/limits";
import { readUnread, synchronize, loadSyncCursor, checkpointSync, membershipResets, retainJoinedCursors,
  acknowledge, flushAcknowledgements, inbox, projectMessages, joinedRooms, type Sync } from "@crossfire/agent-core/receive";
import { discoverRuntime, runtimeName } from './adapters.js';
import { recordClaudeHook } from '@crossfire/adapter-claude/hook';
import { connectProject, selectProfile } from './connect.js';
import { localListener, runListener } from './listener-process.js';
import { listenerSettings } from './settings.js';
import type { Manifest } from '@crossfire/contracts/release';
import { roomOptions, runRoomCommand } from './room-access.js';
import { listenerOptions } from './listener-options.js';

const globals = ["project", "profile", "max-output-bytes"];
const localOptions: Record<string, readonly string[]> = {
  connect: ['server', 'owner', 'runtime'], disconnect: [], status: [], test: [], read: ["room", "limit"], directory: ['search', 'page', 'page-size'],
  listen: ["room", "limit", "runtime", "poll-ms", "debounce-ms", "reconcile-ms"],
};

export async function main(arguments_: string[], installation: () => Manifest, file: string): Promise<void> {
  if (!['linux', 'darwin'].includes(process.platform) || Number(process.versions.node.split(".")[0]) < 26) throw new Error("Crossfire agents require Linux or macOS and Node.js 26+: https://nodejs.org/en/download");
  if (arguments_.length === 2 && arguments_[0] === 'runtime' && arguments_[1] === 'claude-hook') {
    const buffers: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
      if (size > 128 * 1024) throw new Error('Claude hook context exceeds its byte bound');
      buffers.push(bytes);
    }
    recordClaudeHook(JSON.parse(Buffer.concat(buffers).toString()) as unknown); return;
  }
  const options: Record<string, { type: "string" | "boolean"; multiple?: boolean }> = { help: { type: "boolean" } };
  for (const name of [...globals, ...Object.values(localOptions).flat(), ...Object.values(roomOptions).flat(), ...operations.flatMap(operation => operationOptions(operation))]) {
    options[name] = { type: "string", multiple: true };
  }
  const parsed = parseArgs({ args: arguments_, allowPositionals: true, options });
  const values = parsed.values as Arguments;
  const [group, command] = parsed.positionals;
  if (parsed.positionals.length > 2) throw new Error("Expected one namespace and one command");
  const maximum = outputBytes(option(values, "max-output-bytes"));
  if (values.help) {
    if (group === "matrix" && command) emit(selectOperation(command), maximum);
    else if (group === "matrix") emit({ namespace: "matrix", schema: "v1.12", operations: operations.map(operation => ({ command: operation.command, access: operation.access })) }, maximum);
    else emit({ usage: "node .crossfire/client.mjs [--project DIRECTORY] [--profile NAME] agent connect|disconnect|status|test|read|directory", agent: Object.fromEntries(Object.entries(localOptions).filter(([name]) => name !== 'listen')), room: roomOptions,
      matrix: "Native Matrix operation IDs converted to kebab-case; use matrix COMMAND --help.",
      output: "64 KiB default; finite --max-output-bytes 1024..98304",
      identity: "Project-local profiles; private owner DM, explicit additional rooms. The runtime server remains user-owned." }, maximum);
    return;
  }
  if (group !== "agent" && group !== "matrix" && group !== 'room') throw new Error("Use agent, room or matrix");
  if (!command) throw new Error("Supply a command");
  const operation = group === "matrix" ? selectOperation(command) : undefined;
  const commands: Record<string, readonly string[]> = group === 'room' ? roomOptions : localOptions;
  if (!operation && !Object.hasOwn(commands, command)) throw new Error("Unknown command; use --help");
  const allowed = new Set([...globals, ...(operation ? operationOptions(operation) : commands[command]!)]);
  for (const name of Object.keys(values)) if (!allowed.has(name)) throw new Error("Unsupported option --" + name);
  const listener = group === "agent" && command === "listen" ? listenerOptions(values) : undefined;
  if (command === "connect" && group === "agent") {
    const result = await connectProject({ project: option(values, 'project') ?? process.cwd(), profile: option(values, 'profile'),
      server: option(values, 'server'), owner: option(values, 'owner'), runtime: option(values, 'runtime'), file, maximum });
    if (result.handoff) await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [result.handoff!, ...arguments_], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('Connection did not complete; see the instructions above')));
    });
    return;
  }
  const project = realpathSync(option(values, 'project') ?? process.cwd());
  const destination = paths(project, selectProfile(project, option(values, 'profile')));
  const installed = installation();
  const settings = listener ? listenerSettings(destination.state, runtimeName(option(values, 'runtime'))) : undefined;
  const runtime = settings ? discoverRuntime(settings.runtime, project) : undefined;
  if (group === 'agent' && ['disconnect', 'status', 'test'].includes(command)) {
    const unlock = await acquireProcessLock(join(destination.state, 'connection'), 35);
    try {
      const listener = await localListener(destination, command === 'disconnect' ? 'stop' : command === 'test' ? 'test' : 'status');
      if (command === 'test' && (!listener?.ready || !listener.test)) throw new Error('No working listener is attached. Run node .crossfire/client.mjs agent connect, then agent test again.');
      emit({ status: command === 'disconnect' ? 'disconnected' : command === 'test' ? 'passed' : 'status', listener }, maximum);
    }
    finally { await unlock(); }
    return;
  }
  const selected = readProfile(destination.profile);
  if (realpathSync(selected.workspace) !== destination.workspace) throw new Error("Profile belongs to another project");
  if (group === 'room' || group === 'agent' && command === 'directory') {
    const result = await runRoomCommand(selected, command, values);
    if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
    emit(result.value, maximum); return;
  }
  const receiverOwned = group === "agent" && command !== 'listen' || operation && ["setReadMarker", "postReceipt"].includes(operation.id);
  const release = receiverOwned ? await acquireProcessLock(join(destination.state, "receiver")) : undefined;
  try {
    const client = matrix({ base: selected.settings.homeserver, token: selected.account.access_token });
    const coordination = createCoordination({ origin: selected.settings.homeserver, token: selected.account.access_token });
    if (operation) {
      const view = option(values, "view");
      if (view && !["messages", "inbox"].includes(view)) throw new Error("Unknown output view");
      if (view === "inbox" && operation.id !== "sync") throw new Error("--view inbox requires matrix sync");
      if (view && option(values, "output-file")) throw new Error("File output preserves the native response; do not combine it with --view");
      const result = await executeOperation(client, selected.settings, selected.account, operation, values);
      emit(view === "inbox" ? inbox(result as Sync) : view === "messages" ? projectMessages(result) : result, maximum);
    } else if (command === "listen") {
        const room = option(values, 'room');
        await runListener(destination, { ...selected, coordination, release: installed, cursorFile: destination.cursors, maximumBytes: maximum,
          limit: integerOption(option(values, "limit"), DEFAULT_EVENTS, 1, MAX_EVENTS, "--limit"), ...(room ? { room } : {}),
          pollMs: listener!.pollMs, debounceMs: listener!.debounceMs, reconcileMs: listener!.reconcileMs,
          runtime: runtime!.runtime,
        }, runtime!);
    } else {
      const view = await coordination.delivery(selected.id);
      if (!view.ok) throw new Error(view.error.message);
      if (view.value.ownerMatrixId !== selected.settings.owner || view.value.matrixUserId !== selected.account.user_id
        || view.value.status !== "active" || view.value.ownerStatus !== "active") throw new Error("Agent access is not active");
      await flushAcknowledgements(storage, client, destination.cursors);
      const since = loadSyncCursor(storage, destination.cursors);
      const synced = await synchronize(client, since);
      const reset = await membershipResets(client, synced, selected.account, since);
      const joined = await joinedRooms(client);
      retainJoinedCursors(storage, destination.cursors, new Set(joined.filter(room => !reset.has(room))));
      checkpointSync(storage, destination.cursors, synced.next_batch);
      const rooms = new Set(view.value.roomGrants.filter(grant => !grant.muted).map(grant => grant.roomId));
      const batch = await readUnread(storage, client, selected.settings, destination.cursors,
        integerOption(option(values, "limit"), DEFAULT_EVENTS, 1, MAX_EVENTS, "--limit"),
        option(values, "room"), maximum, synced.next_batch, rooms);
      emit({ instance: selected.settings.instance, owner: selected.settings.owner, user_id: selected.account.user_id,
        events: batch.events, more: batch.more_rooms.length > 0, more_rooms: batch.more_rooms }, maximum);
      await acknowledge(storage, client, destination.cursors, batch);
    }
  } finally { await release?.(); }
}
