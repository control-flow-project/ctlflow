import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { failure, success } from '@crossfire/kernel/result';
import type { OwnedRuntimeAdapter, OwnedRuntimeConnection } from '@crossfire/agent-core/owned-runtime';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { prepareProject, paths } from '@crossfire/adapter-filesystem/project';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
import { privateDir, writeJson } from '@crossfire/adapter-filesystem/index';
import { installSoftware, installedSoftware } from '@crossfire/adapter-crossfire/software';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { createClient } from '@crossfire/adapter-crossfire/client';
import { createFleetControlConnection, type FleetControlConnection } from '@crossfire/adapter-crossfire/fleet-control';
import { operations } from '@crossfire/contracts/rest/operations';
import { errorCode } from '@crossfire/contracts/rest/envelope';
import { MAX_UPLOAD_BYTES } from '@crossfire/contracts/client';
import { isListenerStop } from '@crossfire/agent-core/lifecycle';
import { loadBinding, saveBinding, protectFleet } from '@fleetd/storage/binding';
import type { Execution } from '@fleetd/domain/port';
import { prepareEnrollment } from './enrollment.js';
import { failureReporter } from './failures.js';
import { resetInstance, resetInstructions } from './reset.js';

export function createExecution(adapters: Record<string, OwnedRuntimeAdapter>): Execution {
  const connections = new Map<string, FleetControlConnection>();
  const reporters = new Map<string, ReturnType<typeof failureReporter>>();
  function connect(configuration: Parameters<Execution['connect']>[0], signal: AbortSignal) {
    try {
      const binding = loadBinding(configuration); if (!binding.ok) return binding;
      if (!binding.value.fleetId || !binding.value.controllerCredential) return success(undefined);
      if (binding.value.server !== configuration.roster.coordination.server || binding.value.owner !== configuration.roster.coordination.owner
        || binding.value.fleetKey !== configuration.roster.fleet) return failure('conflict', 'Fleet binding does not match its coordination configuration');
      if (connections.has(configuration.directory)) return success(undefined);
      const reporter = failureReporter(configuration.directory, binding.value, signal);
      try {
        const connection = createFleetControlConnection({ origin: binding.value.server, credential: binding.value.controllerCredential,
          fleetId: binding.value.fleetId, owner: binding.value.owner, signal });
        reporters.set(configuration.directory, reporter); connections.set(configuration.directory, connection);
      } catch (error) { void reporter.close(); throw error; }
      return success(undefined);
    } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Invalid fleet controller binding'); }
  }
  return {
    connect,
    connection(configuration) {
      const status = connections.get(configuration.directory)?.status() ?? { connected: false, deliveryEnabled: false, revision: null, error: 'Fleet has no approved controller binding' };
      return { ...status, error: reporters.get(configuration.directory)?.error() ?? status.error };
    },
    async delivery(configuration, input) {
      const connection = connections.get(configuration.directory);
      return connection ? connection.delivery(input) : failure('conflict', 'Enroll this fleet before changing its delivery');
    },
    async message(configuration, input) {
      const connection = connections.get(configuration.directory);
      return connection ? connection.message(input) : failure('conflict', 'Enroll this fleet before sending messages');
    },
    async close() { await Promise.all([...connections.values()].map(connection => connection.close())); connections.clear();
      await Promise.all([...reporters.values()].map(reporter => reporter.close())); reporters.clear(); },
    async disconnect(configuration) { const connection = connections.get(configuration.directory); connections.delete(configuration.directory); await connection?.close();
      const reporter = reporters.get(configuration.directory); reporters.delete(configuration.directory); await reporter?.close(); },
    validate(configuration) {
      for (const definition of Object.values(configuration.definitions)) {
        const adapter = adapters[definition.runtime];
        if (!adapter) return failure('invalid', 'Unsupported runtime: ' + definition.runtime);
        const options = adapter.validate(definition.options);
        if (!options.ok) return options;
      }
      return success(undefined);
    },
    async prepare(configuration, controller, signal, approval) {
      try { protectFleet(configuration.directory); return await prepareEnrollment(configuration, controller, signal, approval); }
      catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Fleet enrollment failed'); }
    },
    async reset(configuration, instance, resetId, signal) {
      const definition = configuration.definitions[instance.definition]!, adapter = adapters[definition.runtime];
      const binding = loadBinding(configuration);
      if (!binding.ok) return binding;
      const identity = binding.value.identities.find(item => item.instanceKey === instance.key);
      if (!identity) return failure('missing', 'Instance has no enrolled identity');
      return adapter ? resetInstance(configuration, instance, identity.agentId, resetId, adapter, signal) : failure('invalid', 'Unsupported runtime: ' + definition.runtime);
    },
    async start(configuration, instance, signal, reason) {
      let release: (() => Promise<void>) | undefined, destination: OwnedRuntimeConnection | undefined;
      let done: Promise<void> | undefined;
      let bindingControl: ReturnType<FleetControlConnection['listener']> | undefined;
      let enrolledId: string | undefined, reported = false;
      const stop = new AbortController(), lifetime = AbortSignal.any([signal, stop.signal]);
      const report = (error: unknown) => {
        if (reported || !enrolledId || signal.aborted || stop.signal.aborted || isListenerStop(error)) return;
        reported = true;
        reporters.get(configuration.directory)?.record(enrolledId, destination?.sessionId ?? null, error);
      };
      try {
        const loaded = loadBinding(configuration);
        if (!loaded.ok) return loaded;
        const binding = loaded.value, identity = binding.identities.find(item => item.instanceKey === instance.key);
        if (!identity) return failure('missing', 'Instance has no enrolled identity');
        enrolledId = identity.agentId;
        const connection = connections.get(configuration.directory);
        if (!connection) return failure('conflict', 'Fleet controller connection is not initialized');
        const definition = configuration.definitions[instance.definition]!;
        const adapter = adapters[definition.runtime];
        if (!adapter) return failure('invalid', 'Unsupported runtime: ' + definition.runtime);
        const workspace = privateDir(join(configuration.directory, instance.workarea));
        prepareProject(workspace);
        const local = paths(workspace, instance.name);
        release = await acquireProcessLock(join(local.state, 'listener'));
        const software = reason === 'recovery' ? installedSoftware(local.root) : await installSoftware(local.root, binding.server);
        const client = createClient({ origin: binding.server, token: identity.account.access_token, signal: lifetime });
        const health = await client.call(operations.health, {}, {});
        if (!health.ok) { report(new Error('Instance startup failed: ' + health.error.message)); await release(); return health; }
        const settings = { instance: health.value.data.instance, homeserver: binding.server, server_name: binding.owner.slice(binding.owner.indexOf(':') + 1), owner: binding.owner, max_upload_bytes: MAX_UPLOAD_BYTES };
        writeJson(local.profile, { id: identity.agentId, workspace, account: identity.account, settings });
        software.activate();
        const instructions = [definition.instructions, 'Crossfire identity: ' + instance.name + '. This instance is already enrolled and its listener is managed by the fleet controller. Do not reconnect, enroll or start another listener.',
          'Use node .crossfire/client.mjs --profile ' + instance.name + ' for intentional Matrix replies and attachments. Connection and telemetry require no model action.',
          resetInstructions(local.state), readFileSync(software.skill.path, 'utf8')].join('\n\n');
        let ready!: () => void, rejectReady!: (error: unknown) => void;
        bindingControl = connection.listener(identity.agentId);
        const readiness = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
        done = listen({ settings, account: identity.account, id: identity.agentId, coordination: createCoordination({ origin: binding.server, token: identity.account.access_token }),
          binding: 'fleet-' + identity.agentId,
          control: bindingControl.control,
          release: software.manifest, cursorFile: local.cursors, limit: 100, pollMs: 10000, debounceMs: 1000, reconcileMs: 30000,
          historyMode: instance.listener_options?.history_mode ?? 'shared',
          ready,
          runtime: async (runtimeStop, _poll, hooks) => {
            const started = await adapter.start({ name: instance.name, workspace, instructions, options: definition.options, hooks,
              ...(instance.listener_options ? { listenerOptions: instance.listener_options } : {}) }, runtimeStop);
            if (!started.ok) throw Object.assign(new Error(started.error.message), { code: started.error.code });
            destination = started.value; return destination;
          },
        }, lifetime).then(() => { const error = new Error('Listener ended'); rejectReady(error); stop.abort(error); }, error => {
          report(error);
          rejectReady(error); stop.abort(error);
        });
        await readiness;
        if (!destination) throw new Error('Runtime did not report its session');
        reporters.get(configuration.directory)?.recovered(identity.agentId);
        let closing: Promise<void> | undefined;
        const unlock = release;
        const close = () => closing ??= (async () => { stop.abort(new Error('Instance stopped')); await done; bindingControl?.close(); await destination?.close(); await unlock(); })();
        return success({ sessionId: destination.sessionId, signal: stop.signal, attachment: destination.attachment,
          attachments: destination.attachments, control: bindingControl.control, close });
      } catch (error) {
        report(error); stop.abort(error); await done; bindingControl?.close(); await destination?.close(); await release?.();
        const parsed = errorCode(error && typeof error === 'object' && 'code' in error ? error.code : undefined);
        return failure(parsed.ok ? parsed.value : 'native', error instanceof Error ? error.message : 'Instance startup failed');
      }
    },
    async detach(configuration, instance) {
      try {
        const loaded = loadBinding(configuration);
        if (!loaded.ok) return loaded;
        const binding = loaded.value, identity = binding.identities.find(item => item.instanceKey === instance.key);
        if (!identity) return success(undefined);
        if (!binding.fleetId || !binding.controllerCredential) return failure('forbidden', 'Fleet controller credential is missing');
        const client = createClient({ origin: binding.server, token: binding.controllerCredential });
        const current = await client.call(operations.fleet, { fleetId: binding.fleetId }, {});
        if (!current.ok) return current;
        const removed = await client.call(operations.unbindFleetAgent, { fleetId: binding.fleetId, agentId: identity.agentId }, { expectedRevision: current.value.data.revision, instanceKey: instance.key });
        if (!removed.ok) return removed;
        saveBinding(configuration.directory, { ...binding, request: null });
        return success(undefined);
      } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Could not detach instance'); }
    },
  };
}
