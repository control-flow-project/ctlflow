import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { matrix } from '@ctlflow/crossfire-adapter-matrix/http';
import { operations, option, selectOperation, executeOperation, operationOptions, type Arguments } from '@ctlflow/crossfire-adapter-matrix/commands';
import { paths, readProfile } from '@ctlflow/crossfire-adapter-filesystem/project';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { listenerRequest } from '@ctlflow/crossfire-adapter-crossfire/listener-client';
import { profileName } from '@ctlflow/crossfire-contracts/client';
import { outputBytes } from '@ctlflow/crossfire-contracts/limits';
import { inbox, projectMessages, type Sync } from '@ctlflow/crossfire-agent-core/receive';
import { emit } from './output.js';
import { readHistory } from './history.js';
import { roomOptions, runRoomCommand } from './room-access.js';
import { publishReport } from './publish.js';

const globals = ['project', 'profile', 'max-output-bytes'];
const reportOptions = { publish: ['directory', 'title'] };
const agentOptions: Record<string, readonly string[]> = {
  status: [], test: [], read: ['room', 'limit'], history: ['room', 'limit', 'direction', 'continuation'],
  directory: ['search', 'page', 'page-size'],
};

function selectedProfile(workspace: string, requested?: string): string {
  if (requested) {
    if (!profileName(requested)) throw new Error('Invalid --profile: use the controller-assigned agent name');
    return requested;
  }
  const directory = join(workspace, '.crossfire/profiles');
  const names = existsSync(directory) ? readdirSync(directory).filter(file => file.endsWith('.json'))
    .map(file => file.slice(0, -5)).filter(profileName).sort() : [];
  if (names.length === 1) return names[0]!;
  throw new Error(names.length ? 'Select a saved identity with --profile: ' + names.join(', ') : 'No enrolled identity here. Use fleet setup from the management setup guide.');
}

export async function main(arguments_: string[]): Promise<void> {
  if (!['linux', 'darwin'].includes(process.platform) || Number(process.versions.node.split('.')[0]) < 26) throw new Error('Crossfire tools require Linux or macOS and Node.js 26+: https://nodejs.org/en/download');
  const options: Record<string, { type: 'string' | 'boolean'; multiple?: boolean }> = { help: { type: 'boolean' } };
  for (const name of [...globals, ...Object.values(agentOptions).flat(), ...Object.values(roomOptions).flat(), ...Object.values(reportOptions).flat(), ...operations.flatMap(operation => operationOptions(operation))]) options[name] = { type: 'string', multiple: true };
  const parsed = parseArgs({ args: arguments_, allowPositionals: true, options });
  const values = parsed.values as Arguments;
  const [group, command] = parsed.positionals;
  if (parsed.positionals.length > 2) throw new Error('Expected one namespace and one command');
  const maximum = outputBytes(option(values, 'max-output-bytes'));
  if (values.help) {
    if (group === 'matrix' && command) emit(selectOperation(command), maximum);
    else if (group === 'matrix') emit({ namespace: 'matrix', schema: 'v1.12', operations: operations.map(operation => ({ command: operation.command, access: operation.access })) }, maximum);
    else emit({ usage: 'node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" [--project DIRECTORY] [--profile NAME] agent status|test|read|history|directory', agent: agentOptions, room: roomOptions,
      matrix: 'Native Matrix operation IDs converted to kebab-case; use matrix COMMAND --help.',
      report: 'report publish --directory DIRECTORY --title TITLE uploads public static reports. Anyone with the link can read them.',
      output: '64 KiB default; finite --max-output-bytes 1024..98304',
      lifecycle: 'fleetd owns enrollment, the shared receiver and native sessions. These tools never start or replace them.' }, maximum);
    return;
  }
  if (group !== 'agent' && group !== 'matrix' && group !== 'room' && group !== 'report') throw new Error('Use agent, room, report or matrix');
  if (!command) throw new Error('Supply a command');
  const operation = group === 'matrix' ? selectOperation(command) : undefined;
  const commands: Record<string, readonly string[]> = group === 'room' ? roomOptions : group === 'report' ? reportOptions : agentOptions;
  if (!operation && !Object.hasOwn(commands, command)) throw new Error('Unknown command; use --help. Native lifecycle belongs to fleet.');
  const allowed = new Set([...globals, ...(operation ? operationOptions(operation) : commands[command]!)]);
  for (const name of Object.keys(values)) if (!allowed.has(name)) throw new Error('Unsupported option --' + name);
  const project = option(values, 'project') ?? process.env.CROSSFIRE_PROJECT;
  if (!project) throw new Error('Use the controller-provided CROSSFIRE_PROJECT or explicit --project private state directory');
  const workspace = realpathSync(project);
  const destination = paths(workspace, selectedProfile(workspace, option(values, 'profile') ?? process.env.CROSSFIRE_AGENT_NAME));
  const selected = readProfile(destination.profile);
  if (realpathSync(selected.workspace) !== destination.workspace) throw new Error('Profile belongs to another private state directory');
  if (group === 'agent' && (command === 'status' || command === 'test')) {
    const status = await listenerRequest(destination.state, { action: command });
    if (!status) throw new Error('The owning controller receiver is unavailable. Inspect fleet status; no replacement listener was started.');
    if (!status.ok) throw new Error(status.error.code + ': ' + status.error.message);
    if (command === 'test' && (!status.value.ready || !status.value.test)) throw new Error('The controller receiver is not ready; inspect fleet status and the agent Session page.');
    emit({ status: command === 'test' ? 'passed' : 'status', listener: status.value }, maximum); return;
  }
  if (group === 'report') {
    const directory = option(values, 'directory'), title = option(values, 'title');
    if (!directory || !title) throw new Error('Supply report publish --directory DIRECTORY --title TITLE; all report files become public');
    const result = await publishReport(selected, directory, title);
    if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
    emit(result.value, maximum); return;
  }
  if (group === 'agent' && (command === 'read' || command === 'history')) { await readHistory(destination, command, values, maximum); return; }
  if (group === 'room' || group === 'agent' && command === 'directory') {
    const result = await runRoomCommand(selected, command, values);
    if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
    emit(result.value, maximum); return;
  }
  if (!operation) throw new Error('Unknown Matrix operation');
  const view = option(values, 'view');
  if (view && !['messages', 'inbox'].includes(view)) throw new Error('Unknown output view');
  if (view === 'inbox' && operation.id !== 'sync') throw new Error('--view inbox requires matrix sync');
  if (view && option(values, 'output-file')) throw new Error('File output preserves the native response; do not combine it with --view');
  const unlock = ['setReadMarker', 'postReceipt'].includes(operation.id) ? await acquireProcessLock(join(destination.state, 'receiver')) : undefined;
  try {
    const client = matrix({ base: selected.settings.homeserver, token: selected.account.access_token });
    const result = await executeOperation(client, selected.settings, selected.account, operation, values);
    emit(view === 'inbox' ? inbox(result as Sync) : view === 'messages' ? projectMessages(result) : result, maximum);
  } finally { await unlock?.(); }
}
