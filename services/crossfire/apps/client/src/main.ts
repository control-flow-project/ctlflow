import { parseArgs } from "node:util";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { spawn } from 'node:child_process';
import { matrix } from "../../../packages/matrix/src/http.js";
import { paths, readProfile, emit, acquireProcessLock } from "../../../packages/agent-core/src/state.js";
import { operations, option, selectOperation, executeOperation, operationOptions, type Arguments } from "../../../packages/matrix/src/commands.js";
import { DEFAULT_EVENTS, MAX_EVENTS, integerOption, outputBytes } from "../../../packages/contracts/src/limits.js";
import { parseAgent } from "../../../packages/contracts/src/management.js";
import { readUnread, synchronize, loadSyncCursor, checkpointSync, membershipResets, retainJoinedCursors,
  acknowledge, flushAcknowledgements, inbox, projectMessages, joinedRooms, type Sync } from "../../../packages/agent-core/src/receive.js";
import { discoverRuntime } from './adapters.js';
import { connectProject, selectProfile } from './connect.js';
import { localListener, runListener } from './listener-process.js';
import { listenerSettings, listenerBinding } from './settings.js';
import type { Manifest } from '../../../packages/contracts/src/release.js';

const globals = ["project", "profile", "max-output-bytes"];
const localOptions: Record<string, readonly string[]> = {
  connect: ['server', 'owner', 'runtime', 'approval-room'], disconnect: [], status: [], read: ["room", "limit"],
  listen: ["room", "limit", "runtime", "approval-room", "poll-ms", "debounce-ms", "reconcile-ms"],
};

export async function main(arguments_: string[], installation: () => Manifest, file: string): Promise<void> {
  if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) < 26) throw new Error("Crossfire requires Linux and Node.js 26+");
  const options: Record<string, { type: "string" | "boolean"; multiple?: boolean }> = { help: { type: "boolean" } };
  for (const name of [...globals, ...Object.values(localOptions).flat(), ...operations.flatMap(operation => operationOptions(operation))]) {
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
    else emit({ usage: "node .crossfire/client.mjs [--project DIRECTORY] [--profile NAME] agent connect|disconnect|status|read", agent: Object.fromEntries(Object.entries(localOptions).filter(([name]) => name !== 'listen')),
      matrix: "Native Matrix operation IDs converted to kebab-case; use matrix COMMAND --help.",
      output: "64 KiB default; finite --max-output-bytes 1024..98304",
      identity: "Project-local profiles; no implicit rooms. The runtime server remains user-owned." }, maximum);
    return;
  }
  if (group !== "agent" && group !== "matrix") throw new Error("Use agent or matrix; superseded top-level commands are not supported");
  if (!command) throw new Error("Supply a command");
  const operation = group === "matrix" ? selectOperation(command) : undefined;
  if (!operation && !Object.hasOwn(localOptions, command)) throw new Error("Unknown agent command; use --help");
  const allowed = new Set([...globals, ...(operation ? operationOptions(operation) : localOptions[command]!)]);
  for (const name of Object.keys(values)) if (!allowed.has(name)) throw new Error("Unsupported option --" + name);
  const listener = group === "agent" && command === "listen" ? {
    pollMs: integerOption(option(values, "poll-ms"), 10_000, 100, 30_000, "--poll-ms"),
    debounceMs: integerOption(option(values, "debounce-ms"), 10_000, 0, 60_000, "--debounce-ms"),
    reconcileMs: integerOption(option(values, "reconcile-ms"), 120_000, 1000, 600_000, "--reconcile-ms"),
  } : undefined;
  if (command === "connect" && group === "agent") {
    const result = await connectProject({ project: option(values, 'project') ?? process.cwd(), profile: option(values, 'profile'),
      server: option(values, 'server'), owner: option(values, 'owner'), runtime: option(values, 'runtime'), approvalRoom: option(values, 'approval-room'), file, maximum });
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
  const settings = listener ? listenerSettings(destination.state, option(values, 'runtime'), option(values, 'approval-room')) : undefined;
  const runtime = settings ? discoverRuntime(settings.runtime, project) : undefined;
  if (group === 'agent' && ['disconnect', 'status'].includes(command)) {
    const unlock = await acquireProcessLock(join(destination.state, 'connection'), 35);
    try { emit({ status: command === 'disconnect' ? 'disconnected' : 'status', listener: await localListener(destination, command === 'disconnect' ? 'stop' : 'status') }, maximum); }
    finally { await unlock(); }
    return;
  }
  const selected = readProfile(destination.profile);
  if (realpathSync(selected.workspace) !== destination.workspace) throw new Error("Profile belongs to another project");
  const receiverOwned = group === "agent" && command !== 'listen' || operation && ["setReadMarker", "postReceipt"].includes(operation.id);
  const release = receiverOwned ? await acquireProcessLock(join(destination.state, "receiver")) : undefined;
  try {
    const client = matrix({ base: selected.settings.homeserver, token: selected.account.access_token });
    if (operation) {
      const view = option(values, "view");
      if (view && !["messages", "inbox"].includes(view)) throw new Error("Unknown output view");
      if (view === "inbox" && operation.id !== "sync") throw new Error("--view inbox requires matrix sync");
      if (view && option(values, "output-file")) throw new Error("File output preserves the native response; do not combine it with --view");
      const result = await executeOperation(client, selected.settings, selected.account, operation, values);
      emit(view === "inbox" ? inbox(result as Sync) : view === "messages" ? projectMessages(result) : result, maximum);
    } else if (command === "listen") {
        const room = option(values, 'room');
        const approvalRoom = settings!.approvalRoom;
        await runListener(destination, { ...selected, release: installed, cursorFile: destination.cursors, maximumBytes: maximum,
          limit: integerOption(option(values, "limit"), DEFAULT_EVENTS, 1, MAX_EVENTS, "--limit"), ...(room ? { room } : {}),
          pollMs: listener!.pollMs, debounceMs: listener!.debounceMs, reconcileMs: listener!.reconcileMs,
          ...(approvalRoom ? { approvalRoom } : {}),
          runtime: runtime!.runtime,
        }, { ...runtime!, binding: listenerBinding(runtime!.binding, approvalRoom) });
    } else {
      const view = parseAgent(await client.get("/_coord/agents/" + selected.id));
      if (!view.ok) throw new Error(view.error.message);
      if (view.value.owner !== selected.settings.owner || view.value.userId !== selected.account.user_id
        || view.value.status !== "active" || view.value.ownerStatus !== "active") throw new Error("Agent access is not active");
      await flushAcknowledgements(client, destination.cursors);
      const since = loadSyncCursor(destination.cursors);
      const synced = await synchronize(client, since);
      const reset = await membershipResets(client, synced, selected.account, since);
      const joined = await joinedRooms(client);
      retainJoinedCursors(destination.cursors, new Set(joined.filter(room => !reset.has(room))));
      checkpointSync(destination.cursors, synced.next_batch);
      const rooms = new Set(view.value.grants.filter(grant => !grant.muted).map(grant => grant.room));
      const batch = await readUnread(client, selected.settings, destination.cursors,
        integerOption(option(values, "limit"), DEFAULT_EVENTS, 1, MAX_EVENTS, "--limit"),
        option(values, "room"), maximum, synced.next_batch, rooms);
      emit({ instance: selected.settings.instance, owner: selected.settings.owner, user_id: selected.account.user_id,
        events: batch.events, more: batch.more_rooms.length > 0, more_rooms: batch.more_rooms }, maximum);
      await acknowledge(client, destination.cursors, batch);
    }
  } finally { await release?.(); }
}
