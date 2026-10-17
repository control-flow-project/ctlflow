#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';
import type { OperationInput } from '@ctlflow/fleetd-contracts/api';
import { openTunnel } from '@ctlflow/fleet-ssh-transport/tunnel';
import { name as nameParser, identifier, text as textParser } from '@ctlflow/crossfire-contracts/schema/validation';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { codexTerminal } from '@ctlflow/crossfire-adapter-codex/terminal';
import { loadConnections, saveConnections } from './configuration.js';
import { launchDaemon, restartDaemon } from './daemon.js';
import { terminalPointer } from './attachment.js';
import { setup } from './setup.js';
import { listFleets, observeOperation } from './operation.js';

function value<Value>(result: Result<Value>): Value { if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message); return result.value; }
function output(value: unknown): void { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
const usage = `fleet setup [--descriptor PERSONALIZED_SETUP_URL] [--config /absolute/runtime.toml] [--root DIRECTORY]
fleet daemon start [--name NAME] [--root DIRECTORY]
fleet daemon status|stop|restart --root DIRECTORY
fleet remote add NAME --ssh USER@HOST --root DIRECTORY
fleet [--root DIRECTORY | --remote NAME] add DIRECTORY
fleet [--root DIRECTORY | --remote NAME] list|show|test|enroll|start|stop|remove [FLEET]
fleet [--root DIRECTORY | --remote NAME] start FLEET [--fresh-history] [--operation-id UUID]
fleet [--root DIRECTORY | --remote NAME] stop FLEET [--operation-id UUID]
fleet [--root DIRECTORY | --remote NAME] update FLEET [--operation-id UUID] [--release-directory DIRECTORY]
fleet [--root DIRECTORY | --remote NAME] activate|deactivate FLEET
fleet [--root DIRECTORY | --remote NAME] message FLEET --text TEXT [--message-id UUID]
fleet agent list FLEET
fleet agent add FLEET INSTANCE --definition DEFINITION
fleet agent start FLEET INSTANCE [--fresh-history] [--operation-id UUID]
fleet agent stop FLEET INSTANCE [--operation-id UUID]
fleet agent update FLEET INSTANCE [--operation-id UUID] [--release-directory DIRECTORY]
fleet agent remove|contexts FLEET INSTANCE
fleet agent attach FLEET INSTANCE [--context CONTEXT]

Start resumes retained history; --fresh-history explicitly replaces it.
Stop clears the selected bindings' desired activation and retains their histories.
Daemon shutdown preserves desired activation for the next daemon start.
Contexts lists saved histories even when sleeping or stopped, without waking them.
Attach only returns a live terminal pointer; resume a sleeping agent first.
Status separates native phase, listener delivery, desired activation and saved history.`;
export async function run(argv: string[], signal: AbortSignal): Promise<void> {
  const { values, positionals, tokens } = parseArgs({ args: argv, allowPositionals: true, tokens: true, options: { root: { type: 'string' }, remote: { type: 'string' },
    name: { type: 'string' }, descriptor: { type: 'string' }, config: { type: 'string' }, ssh: { type: 'string' }, definition: { type: 'string' }, context: { type: 'string' }, text: { type: 'string' }, 'message-id': { type: 'string' }, 'operation-id': { type: 'string' }, 'release-directory': { type: 'string' }, 'fresh-history': { type: 'boolean' }, help: { type: 'boolean' } } });
  const seen = new Set<string>();
  for (const token of tokens) if (token.kind === 'option') {
    if (seen.has(token.name)) throw new Error('Duplicated option --' + token.name);
    seen.add(token.name);
    if (token.value === '') throw new Error('Empty option --' + token.name);
  }
  const allowed = new Set(['root', 'remote', 'help', ...(positionals[0] === 'remote' ? ['ssh'] : []),
    ...(positionals[0] === 'setup' ? ['descriptor', 'config'] : []),
    ...(positionals[0] === 'daemon' && positionals[1] === 'start' ? ['name'] : []),
    ...(positionals[0] === 'agent' && positionals[1] === 'add' ? ['definition'] : []),
    ...(positionals[0] === 'agent' && positionals[1] === 'attach' ? ['context'] : []),
    ...((['enroll', 'start', 'stop', 'update'].includes(positionals[0] ?? '') || positionals[0] === 'agent' && ['start', 'stop', 'update'].includes(positionals[1] ?? '')) ? ['operation-id'] : []),
    ...((positionals[0] === 'update' || positionals[0] === 'agent' && positionals[1] === 'update') ? ['release-directory'] : []),
    ...((positionals[0] === 'start' || positionals[0] === 'agent' && positionals[1] === 'start') ? ['fresh-history'] : []),
    ...(positionals[0] === 'message' ? ['text', 'message-id'] : [])]);
  for (const option of Object.keys(values)) if (!allowed.has(option)) throw new Error('Option is not valid for this command: --' + option);
  if (values.help || !positionals.length) { console.log(usage); return; }
  if (values['operation-id'] !== undefined) value(identifier(values['operation-id']));
  if (values.name !== undefined) value(textParser(100)(values.name));
  const agentStart = positionals[0] === 'agent' && positionals[1] === 'start';
  if (positionals[0] === 'start' || agentStart) {
    if (positionals.length !== (agentStart ? 4 : 2)) throw new Error(usage);
    const fleetKey = positionals[agentStart ? 2 : 1];
    if (!nameParser(fleetKey).ok && !identifier(fleetKey).ok) throw new Error('Use a configured fleet key or UUID');
    if (agentStart) value(nameParser(positionals[3]));
  }
  if (positionals[0] === 'daemon' && positionals[1] === 'start' && positionals.length !== 2) throw new Error(usage);
  if (positionals[0] === 'setup') {
    if (positionals.length !== 1 || values.remote) throw new Error('Setup runs locally on the computer that will own the fleet');
    await setup(values, signal, output); return;
  }
  const connections = loadConnections();
  if (positionals[0] === 'remote') {
    if (positionals.length !== 3 || positionals[1] !== 'add' || !values.ssh || !values.root || !values.root.startsWith('/')) throw new Error(usage);
    const name = value(nameParser(positionals[2]));
    if (connections.remotes.some(remote => remote.name === name)) throw new Error('Remote name already exists');
    connections.remotes.push({ name, ssh: values.ssh, root: values.root }); saveConnections(connections); output({ saved: name }); return;
  }
  if (values.remote && values.root) throw new Error('Select a local root or a remote, not both');
  let root = values.root ? resolve(values.root) : connections.localRoot;
  const remote = values.remote ? connections.remotes.find(remote => remote.name === values.remote) : undefined;
  if (values.remote && !remote) throw new Error('Remote connection not found');
  if (remote) root = remote.root;
  if (!root) throw new Error('Select --root DIRECTORY or --remote NAME');
  if (positionals[0] === 'daemon' && positionals[1] === 'start') {
    if (remote || positionals.length !== 2) throw new Error('Start the daemon locally on its computer');
    const status = await launchDaemon(root, values.name, signal);
    connections.localRoot = root; saveConnections(connections); output(status); return;
  }
  if (!remote && (positionals[0] === 'start' || positionals[0] === 'agent' && positionals[1] === 'start')) await launchDaemon(root, undefined, signal);
  const tunnel = remote ? await openTunnel(remote.ssh, root, signal) : undefined;
  try {
    const client = createDaemonClient(tunnel?.socketPath ?? join(root, 'fleetd.sock'), signal);
    if (positionals[0] === 'daemon') {
      if (positionals.length !== 2 || !['status', 'stop', 'restart'].includes(positionals[1]!)) throw new Error(usage);
      if (positionals[1] === 'restart') {
        if (remote) throw new Error('Restart runs locally on the controller computer; use its installed fleet CLI over SSH');
        output(await restartDaemon(root, signal)); return;
      }
      output(positionals[1] === 'status' ? value(await client.call(operations.status, {}, {})).data
        : value(await client.call(operations.operate, {}, { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon' }, expectedRevision: 0 })).data); return;
    }
    if (positionals[0] === 'add') {
      if (positionals.length !== 2) throw new Error(usage);
      const directory = remote ? positionals[1]! : resolve(positionals[1]!);
      output(value(await client.call(operations.addFleet, {}, { directory })).data); return;
    }
    const listed = await listFleets(client);
    if (positionals[0] === 'list' && positionals.length === 1) { output(listed); return; }
    const agentCommand = positionals[0] === 'agent', command = positionals[agentCommand ? 1 : 0], fleetKey = positionals[agentCommand ? 2 : 1];
    const fleet = listed.find(fleet => fleet.fleetKey === fleetKey || fleet.fleetId === fleetKey);
    if (!fleet) throw new Error('Fleet not found: ' + fleetKey);
    const params = { fleetId: fleet.fleetId };
    if (!agentCommand && ['activate', 'deactivate'].includes(command ?? '') && positionals.length === 2) {
      if (!fleet.connection.connected || fleet.connection.revision === null) throw new Error('Fleet controller is not connected to Crossfire');
      output(value(await client.call(operations.changeFleetDelivery, params, { expectedRevision: fleet.connection.revision, enabled: command === 'activate' })).data); return;
    }
    if (!agentCommand && command === 'message' && positionals.length === 2 && values.text) {
      const messageId = value(identifier(values['message-id'] ?? randomUUID()));
      output({ messageId });
      output(value(await client.call(operations.createFleetMessage, params, { messageId, body: values.text })).data); return;
    }
    if (!agentCommand && command === 'show' && positionals.length === 2) { output(fleet); return; }
    if (!agentCommand && command === 'test' && positionals.length === 2) { output(value(await client.call(operations.readiness, params, {})).data); return; }
    if (agentCommand && command === 'list' && positionals.length === 3) { output(fleet.instances); return; }
    if (!agentCommand && command === 'remove' && positionals.length === 2) { output(value(await client.call(operations.removeFleet, params, { expectedRevision: fleet.revision })).data); return; }
    const instanceKey = agentCommand ? value(nameParser(positionals[3])) : undefined;
    if (agentCommand && positionals.length !== 4 || !agentCommand && positionals.length !== 2) throw new Error(usage);
    if (agentCommand && command === 'add') {
      const definition = value(nameParser(values.definition));
      output(value(await client.call(operations.addAgent, params, { expectedRevision: fleet.revision, instance: { key: instanceKey!, name: instanceKey!, definition,
        workarea: 'agents/' + definition + '/workarea/' + instanceKey } })).data); return;
    }
    if (agentCommand && command === 'remove') { output(value(await client.call(operations.removeAgent, { ...params, instanceKey: instanceKey! }, { expectedRevision: fleet.revision })).data); return; }
    if (agentCommand && command === 'contexts') { output(value(await client.call(operations.contexts, { ...params, instanceKey: instanceKey! }, {})).data); return; }
    if (agentCommand && command === 'attach') { const pointer = value(await terminalPointer(client, fleet.fleetId, instanceKey!, { codex: codexTerminal() }, remote?.ssh, values.context)); process.stdout.write(pointer.command + '\n'); return; }
    if (command === 'enroll' && agentCommand) throw new Error('Use fleet enroll for the stopped whole fleet');
    if (command !== 'enroll' && command !== 'start' && command !== 'stop' && command !== 'update') throw new Error(usage);
    if (command === 'update' && remote && !values['release-directory']) throw new Error('Remote update requires --release-directory with the installed fleetd artifact directory on its computer, or run its installed fleet CLI over SSH');
    const request: OperationInput = { operationId: value(identifier(values['operation-id'] ?? randomUUID())), action: values['fresh-history'] ? 'reset' : command, expectedRevision: fleet.revision,
      target: agentCommand ? { kind: 'agent' as const, fleetId: fleet.fleetId, instanceKey: instanceKey! } : { kind: 'fleet' as const, fleetId: fleet.fleetId },
      ...(command === 'update' ? { releaseDirectory: values['release-directory'] ?? dirname(fileURLToPath(import.meta.resolve('@ctlflow/fleetd/artifacts'))) } : {}) };
    output({ operationId: request.operationId });
    output(await observeOperation(client, value(await client.call(operations.operate, {}, request)).data, signal, output));
  } finally { await tunnel?.close(); }
}
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort(new Error('CLI disconnected; daemon operations continue')));
  void run(process.argv.slice(2), stop.signal).catch(error => { console.error(error instanceof Error ? error.message : 'Fleet command failed'); process.exitCode = 1; });
}
