#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createDaemonClient, operations } from '@fleet/daemon-client/client';
import { openTunnel } from '@fleet/ssh-transport/tunnel';
import { name as nameParser, identifier } from '@crossfire/contracts/schema/validation';
import type { Result } from '@crossfire/kernel/result';
import { codexTerminal } from '@crossfire/adapter-codex/terminal';
import { loadConnections, saveConnections } from './configuration.js';
import { launchDaemon } from './daemon.js';
import { terminalPointer } from './attachment.js';

function value<Value>(result: Result<Value>): Value { if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message); return result.value; }
function output(value: unknown): void { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
const usage = `fleet daemon start --name NAME --root DIRECTORY
fleet daemon status|stop --root DIRECTORY
fleet remote add NAME --ssh USER@HOST --root DIRECTORY
fleet [--root DIRECTORY | --remote NAME] add DIRECTORY
fleet [--root DIRECTORY | --remote NAME] list|show|start|stop|remove [FLEET]
fleet [--root DIRECTORY | --remote NAME] activate|deactivate FLEET
fleet [--root DIRECTORY | --remote NAME] message FLEET --text TEXT [--message-id UUID]
fleet agent list FLEET
fleet agent add FLEET INSTANCE --definition DEFINITION
fleet agent start|stop|remove|contexts FLEET INSTANCE
fleet agent attach FLEET INSTANCE [--context CONTEXT]`;
export async function run(argv: string[], signal: AbortSignal): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { root: { type: 'string' }, remote: { type: 'string' },
    name: { type: 'string' }, ssh: { type: 'string' }, definition: { type: 'string' }, context: { type: 'string' }, text: { type: 'string' }, 'message-id': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help || !positionals.length) { console.log(usage); return; }
  const allowed = new Set(['root', 'remote', ...(positionals[0] === 'remote' ? ['ssh'] : []),
    ...(positionals[0] === 'daemon' && positionals[1] === 'start' ? ['name'] : []),
    ...(positionals[0] === 'agent' && positionals[1] === 'add' ? ['definition'] : []),
    ...(positionals[0] === 'agent' && positionals[1] === 'attach' ? ['context'] : []),
    ...(positionals[0] === 'message' ? ['text', 'message-id'] : [])]);
  for (const option of Object.keys(values)) if (!allowed.has(option)) throw new Error('Option is not valid for this command: --' + option);
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
    if (remote || !values.name || positionals.length !== 2) throw new Error('Start a named daemon locally on its computer');
    const status = await launchDaemon(root, values.name, signal);
    connections.localRoot = root; saveConnections(connections); output(status); return;
  }
  const tunnel = remote ? await openTunnel(remote.ssh, root, signal) : undefined;
  try {
    const client = createDaemonClient(tunnel?.socketPath ?? join(root, 'fleetd.sock'), signal);
    if (positionals[0] === 'daemon') {
      if (positionals.length !== 2 || !['status', 'stop'].includes(positionals[1]!)) throw new Error(usage);
      output(positionals[1] === 'status' ? value(await client.call(operations.status, {}, {})).data
        : value(await client.call(operations.operate, {}, { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon' }, expectedRevision: 0 })).data); return;
    }
    if (positionals[0] === 'add') {
      if (positionals.length !== 2) throw new Error(usage);
      const directory = remote ? positionals[1]! : resolve(positionals[1]!);
      output(value(await client.call(operations.addFleet, {}, { directory })).data); return;
    }
    const listed = value(await client.call(operations.fleets, {}, {}, new URLSearchParams({ pageSize: '100' }))).data;
    if (positionals[0] === 'list' && positionals.length === 1) { output(listed); return; }
    const agentCommand = positionals[0] === 'agent', command = positionals[agentCommand ? 1 : 0], fleetKey = positionals[agentCommand ? 2 : 1];
    const fleet = listed.find(fleet => fleet.fleetKey === fleetKey || fleet.fleetId === fleetKey);
    if (!fleet) throw new Error('Fleet not found: ' + fleetKey);
    if (fleet.error) throw new Error(fleet.error);
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
    if (command !== 'start' && command !== 'stop') throw new Error(usage);
    const request = { operationId: randomUUID(), action: command as 'start' | 'stop', expectedRevision: fleet.revision,
      target: agentCommand ? { kind: 'agent' as const, fleetId: fleet.fleetId, instanceKey: instanceKey! } : { kind: 'fleet' as const, fleetId: fleet.fleetId } };
    let operation = value(await client.call(operations.operate, {}, request)).data, notified = '';
    output({ operationId: operation.operationId, status: operation.status });
    for (;;) {
      if (operation.approval && operation.approval.code !== notified) { output({ status: 'awaiting-approval', ...operation.approval }); notified = operation.approval.code; }
      if (operation.status === 'failed') { output(operation); throw new Error('Operation failed; successful peers are retained. Inspect fleet status.'); }
      if (operation.status === 'succeeded') { output(operation); return; }
      await delay(500, undefined, { signal });
      operation = value(await client.call(operations.operation, { operationId: operation.operationId }, {})).data;
    }
  } finally { await tunnel?.close(); }
}
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort(new Error('CLI disconnected; daemon operations continue')));
  void run(process.argv.slice(2), stop.signal).catch(error => { console.error(error instanceof Error ? error.message : 'Fleet command failed'); process.exitCode = 1; });
}
