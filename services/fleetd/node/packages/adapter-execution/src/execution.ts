import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { OwnedRuntimeAdapter } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { createListenerHost, type ListenerHost } from '@ctlflow/crossfire-adapter-crossfire/listener-host';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';
import { createNativeLifecycle } from '@ctlflow/fleetd-domain/native-lifecycle';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { listenerRequest } from '@ctlflow/crossfire-adapter-crossfire/listener-client';
import { prepareProject, paths } from '@ctlflow/crossfire-adapter-filesystem/project';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { privateDir, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { installSoftware, installedSoftware } from '@ctlflow/crossfire-adapter-crossfire/software';
import { createCoordination } from '@ctlflow/crossfire-adapter-crossfire/coordination';
import { createClient } from '@ctlflow/crossfire-client/client';
import { createFleetControlConnection, type FleetControlConnection } from '@ctlflow/crossfire-adapter-crossfire/fleet-control';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { errorCode } from '@ctlflow/crossfire-contracts/rest/envelope';
import { MAX_UPLOAD_BYTES } from '@ctlflow/crossfire-contracts/client';
import { isListenerStop } from '@ctlflow/crossfire-kernel/lifecycle';
import { loadBinding, saveBinding, protectFleet } from '@ctlflow/fleetd-storage/binding';
import type { Execution } from '@ctlflow/fleetd-domain/port';
import { prepareEnrollment } from './enrollment.js';
import { failureReporter } from './failures.js';
import { resetInstance, resetInstructions } from './reset.js';
import { canInitializeHistory, initializedHistory } from '@ctlflow/fleetd-storage/history';
import { createNativeStopReceipts, type NativeStopActivity } from './native-stops.js';
import { createResumeWork } from '@ctlflow/fleetd-storage/resume-work';
import { nativeOptions } from '@ctlflow/fleetd-domain/model';

export function createExecution(adapters: Record<string, OwnedRuntimeAdapter>, artifacts: string, log: (message: string) => void): Execution {
  const connections = new Map<string, FleetControlConnection>();
  const reporters = new Map<string, ReturnType<typeof failureReporter>>();
  const stops = new Map<string, ReturnType<typeof createNativeStopReceipts>>();
  let host: Promise<ListenerHost> | undefined;
  const inspect: Execution['inspect'] = async (configuration, signal, instances = configuration.roster.instances) => {
    try {
      for (const instance of instances) {
        signal.throwIfAborted();
        const definition = configuration.definitions[instance.definition]!, adapter = adapters[definition.runtime];
        if (!adapter) return failure('invalid', 'Unsupported runtime: ' + definition.runtime);
        const stateDirectory = privateDir(join(configuration.directory, instance.workarea));
        const inspected = await adapter.inspect({ stateDirectory, workspace: instance.workspace ?? stateDirectory, options: nativeOptions(configuration, instance) }, signal);
        if (!inspected.ok) return inspected;
      }
      return success(undefined);
    } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Cannot inspect the configured native runtime'); }
  };
  function connect(configuration: Parameters<Execution['connect']>[0], signal: AbortSignal, control: Parameters<Execution['connect']>[2]) {
    try {
      const binding = loadBinding(configuration); if (!binding.ok) return binding;
      if (!binding.value.fleetId || !binding.value.controllerCredential) return success(undefined);
      if (binding.value.server !== configuration.roster.coordination.server || binding.value.owner !== configuration.roster.coordination.owner
        || binding.value.fleetKey !== configuration.roster.fleet) return failure('conflict', 'Fleet binding does not match its coordination configuration');
      if (connections.has(configuration.directory)) return success(undefined);
      const reporter = failureReporter(configuration.directory, binding.value, signal);
      try {
        const connection = createFleetControlConnection({ origin: binding.value.server, credential: binding.value.controllerCredential,
          fleetId: binding.value.fleetId, owner: binding.value.owner, signal, acknowledged: control.acknowledged, execute: async command => {
            const current = loadBinding(configuration); if (!current.ok) return current;
            if (current.value.fleetId !== command.fleetId) return failure('conflict', 'Session command is not for this enrolled fleet');
            const identity = command.agentId === null ? null : current.value.identities.find(item => item.agentId === command.agentId);
            if (command.agentId !== null && !identity) return failure('missing', 'The requested agent has no identity in this controller binding');
            return control.execute({ operationId: command.operationId, action: command.action, instanceKey: identity?.instanceKey ?? null });
          } });
        const receipts = createNativeStopReceipts({ signal, clock: nativeClock, id: randomUUID, connected: () => connection.status().connected,
          send: async (receipt, scope) => {
            const result = await createClient({ origin: binding.value.server, token: receipt.binding.credential, timeoutMs: 5000, signal: scope })
              .call(operations.recordFleetNativeStop, { fleetId: receipt.binding.fleetId, agentId: receipt.agentId },
                { connectionId: receipt.binding.connectionId, runId: receipt.runId, receiptId: receipt.receiptId });
            return result.ok && result.value.data.recorded ? success(undefined) : result.ok ? failure('conflict', 'Crossfire did not accept the native stop receipt') : result;
          } });
        stops.set(configuration.directory, receipts); reporters.set(configuration.directory, reporter); connections.set(configuration.directory, connection);
      } catch (error) { void reporter.close(); throw error; }
      return success(undefined);
    } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Invalid fleet controller binding'); }
  }
  return {
    connect,
    connection(configuration) {
      const status = connections.get(configuration.directory)?.status() ?? { connected: false, deliveryEnabled: false, revision: null, error: 'Fleet has no approved controller binding' };
      return { ...status, error: stops.get(configuration.directory)?.error() ?? reporters.get(configuration.directory)?.error() ?? status.error };
    },
    async delivery(configuration, input) {
      const connection = connections.get(configuration.directory);
      return connection ? connection.delivery(input) : failure('conflict', 'Enroll this fleet before changing its delivery');
    },
    async message(configuration, input) {
      const connection = connections.get(configuration.directory);
      return connection ? connection.message(input) : failure('conflict', 'Enroll this fleet before sending messages');
    },
    async close() { await Promise.all([...stops.values()].map(receipts => receipts.close())); stops.clear();
      await Promise.all([...connections.values()].map(connection => connection.close())); connections.clear();
      await Promise.all([...reporters.values()].map(reporter => reporter.close())); reporters.clear();
      if (host) await (await host).close(); host = undefined; },
    async disconnect(configuration) { const receipts = stops.get(configuration.directory); stops.delete(configuration.directory); await receipts?.close();
      const connection = connections.get(configuration.directory); connections.delete(configuration.directory); await connection?.close();
      const reporter = reporters.get(configuration.directory); reporters.delete(configuration.directory); await reporter?.close(); },
    validate(configuration) {
      for (const definition of Object.values(configuration.definitions)) {
        const adapter = adapters[definition.runtime];
        if (!adapter) return failure('invalid', 'Unsupported runtime: ' + definition.runtime);
        const options = adapter.validate(definition.options);
        if (!options.ok) return options;
      }
      for (const instance of configuration.roster.instances) {
        if (!instance.runtimeOptions) continue;
        const definition = configuration.definitions[instance.definition]!;
        const options = adapters[definition.runtime]!.validate(nativeOptions(configuration, instance));
        if (!options.ok) return options;
      }
      return success(undefined);
    },
    inspect,
    async test(configuration, instance) {
      try {
        const binding = loadBinding(configuration); if (!binding.ok) return binding;
        const identity = binding.value.identities.find(item => item.instanceKey === instance.key);
        if (!identity) return failure('missing', 'Instance has no enrolled identity');
        const local = paths(join(configuration.directory, instance.workarea), instance.key);
        const tested = await listenerRequest(local.state, { action: 'test' });
        if (!tested) return failure('unavailable', 'The owning listener is not connected');
        if (!tested.ok) return tested;
        const diagnosis = tested.value.test;
        if (!tested.value.ready || tested.value.binding !== 'fleet-' + identity.agentId
          || !diagnosis || diagnosis.session !== tested.value.session || diagnosis.server !== configuration.roster.coordination.server
          || diagnosis.busy || diagnosis.deliveryPaused) return failure('conflict', 'Listener authentication, exact native session or idle delivery readiness is not confirmed');
        return success(undefined);
      } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Cannot verify the owning listener'); }
    },
    async prepare(configuration, controller, intent, signal, approval) {
      try {
        const inspected = await inspect(configuration, signal); if (!inspected.ok) return inspected;
        protectFleet(configuration.directory); return await prepareEnrollment(configuration, controller, intent, signal, approval);
      }
      catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Fleet enrollment failed'); }
    },
    async reset(configuration, instance, resetId, signal) {
      const definition = configuration.definitions[instance.definition]!, adapter = adapters[definition.runtime];
      const binding = loadBinding(configuration);
      if (!binding.ok) return binding;
      const identity = binding.value.identities.find(item => item.instanceKey === instance.key);
      if (!identity) return failure('missing', 'Instance has no enrolled identity');
      if (!adapter) return failure('invalid', 'Unsupported runtime: ' + definition.runtime);
      const stateDirectory = privateDir(join(configuration.directory, instance.workarea));
      const admitted = await adapter.inspect({ workspace: instance.workspace ?? stateDirectory, stateDirectory, options: nativeOptions(configuration, instance) }, signal);
      return admitted.ok ? resetInstance(configuration, instance, identity.agentId, resetId, adapter, signal) : admitted;
    },
    async contexts(configuration, instance) {
      try {
        const definition = configuration.definitions[instance.definition]!, adapter = adapters[definition.runtime];
        if (!adapter) return failure('invalid', 'Unsupported runtime: ' + definition.runtime);
        const stateDirectory = join(configuration.directory, instance.workarea);
        if (!lstatSync(stateDirectory, { throwIfNoEntry: false })) return success([]);
        const contexts = await adapter.savedContexts({ stateDirectory, workspace: instance.workspace ?? stateDirectory });
        return contexts.ok ? success(contexts.value.map(({ context, runtime, sessionId }) => ({ context, runtime, sessionId }))) : contexts;
      } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Cannot inspect exact saved native histories'); }
    },
    async confirmStopped(configuration, instance) {
      const loaded = loadBinding(configuration); if (!loaded.ok) return loaded;
      const identity = loaded.value.identities.find(item => item.instanceKey === instance.key);
      return identity ? stops.get(configuration.directory)?.confirm(identity.agentId) ?? success(undefined) : success(undefined);
    },
    async start(configuration, instance, signal, reason) {
      let release: (() => Promise<void>) | undefined;
      let destination: Extract<Awaited<ReturnType<typeof createNativeLifecycle>>, { ok: true }>['value'] | undefined;
      let done: Promise<void> | undefined;
      let bindingControl: ReturnType<FleetControlConnection['listener']> | undefined;
      let activity: NativeStopActivity | undefined;
      let enrolledId: string | undefined, reported = false, deliberatelyClosing = false;
      const stop = new AbortController(), lifetime = AbortSignal.any([signal, stop.signal]);
      const report = (error: unknown) => {
        if (reported || deliberatelyClosing || !enrolledId || signal.aborted || stop.signal.aborted || isListenerStop(error)) return;
        reported = true;
        reporters.get(configuration.directory)?.record(enrolledId, destination?.runtime.sessionId ?? null, error);
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
        const stateDirectory = privateDir(join(configuration.directory, instance.workarea));
        const workspace = instance.workspace ?? stateDirectory;
        prepareProject(stateDirectory);
        const local = paths(stateDirectory, instance.key);
        const listenerHost = await (host ??= createListenerHost());
        release = await acquireProcessLock(join(local.state, 'listener'));
        const software = reason === 'recovery' || existsSync(join(local.root, 'client.mjs')) ? installedSoftware(local.root) : await installSoftware(local.root, artifacts);
        const client = createClient({ origin: binding.server, token: identity.account.access_token, signal: lifetime });
        const health = await client.call(operations.health, {}, {});
        if (!health.ok) { report(new Error('Instance startup failed: ' + health.error.message)); await release(); return health; }
        const settings = { instance: health.value.data.instance, homeserver: binding.server, server_name: binding.owner.slice(binding.owner.indexOf(':') + 1), owner: binding.owner, max_upload_bytes: MAX_UPLOAD_BYTES };
        writeJson(local.profile, { id: identity.agentId, workspace: stateDirectory, account: identity.account, settings });
        software.activate();
        const instructions = [definition.instructions, 'Crossfire identity: ' + instance.name + '. This instance is already enrolled and its listener is managed by the fleet controller. Do not reconnect, enroll or start another listener.',
          'Use the intentional Crossfire tools from CROSSFIRE_PROJECT: node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" --profile ' + instance.key + '. The profile is this instance\'s immutable local key, not its display name. Connection and telemetry require no model action. Never disclose host paths or private machine configuration outside the owner DM.',
          resetInstructions(local.state), readFileSync(software.skill.path, 'utf8')].join('\n\n');
        let ready!: () => void, rejectReady!: (error: unknown) => void;
        bindingControl = connection.listener(identity.agentId);
        const readiness = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
        done = listen({ log, settings, account: identity.account, id: identity.agentId, coordination: createCoordination({ origin: binding.server, token: identity.account.access_token }),
          binding: 'fleet-' + identity.agentId, host: listenerHost,
          control: bindingControl.control,
          release: software.manifest, cursorFile: local.cursors, limit: 100, pollMs: 10000, debounceMs: 1000, reconcileMs: 30000,
          historyMode: instance.listenerOptions?.historyMode ?? 'shared',
          activity: (runId, generation) => { activity = stops.get(configuration.directory)!.activity(identity.agentId, runId, generation, () => bindingControl!.control.binding()); },
          ready: () => {
            if (!destination) { rejectReady(new Error('Runtime did not report its session')); return; }
            void destination.activate().then(ready, error => { rejectReady(error); stop.abort(error); });
          },
          runtime: async (runtimeStop, _poll, hooks) => {
            const options = adapter.validate(nativeOptions(configuration, instance));
            if (!options.ok) throw Object.assign(new Error(options.error.message), { code: options.error.code });
            const started = await createNativeLifecycle({ clock: nativeClock, hooks, runtime: definition.runtime, approval: options.value.approval,
              work: createResumeWork(local.state),
              primary: instance.listenerOptions?.historyMode === 'per-room' ? 'control' : 'shared',
              initialSettings: adapter.configuredSettings(options.value.options),
              initial: reason === 'operator' ? 'running' : 'sleeping',
              saved: () => adapter.savedContexts({ workspace, stateDirectory }),
              failed: (sessionId, error) => reporters.get(configuration.directory)?.record(identity.agentId, sessionId, error),
              recovered: () => reporters.get(configuration.directory)?.recovered(identity.agentId),
              start: async (scope, observe, admission) => {
                const unlock = await listenerHost.budget.acquire('native-start', admission ? AbortSignal.any([scope, admission.signal]) : scope,
                  admission ? 'immediate' : undefined);
                const starting = new AbortController();
                const cancelled = () => starting.abort(admission?.signal.reason);
                admission?.signal.addEventListener('abort', cancelled, { once: true });
                try {
                  admission?.signal.throwIfAborted();
                  const opened = await adapter.start({ profile: instance.key, name: instance.name, workspace, stateDirectory, instructions, options: nativeOptions(configuration, instance), hooks: { ...hooks, observe },
                    allowNewHistory: canInitializeHistory(configuration.directory, identity.agentId),
                    ...(instance.listenerOptions ? { listenerOptions: instance.listenerOptions } : {}) }, AbortSignal.any([scope, starting.signal]));
                  if (admission?.signal.aborted) {
                    if (opened.ok) await opened.value.close();
                    admission.signal.throwIfAborted();
                  }
                  if (opened.ok) initializedHistory(configuration.directory, identity.agentId);
                  return opened;
                } finally { admission?.signal.removeEventListener('abort', cancelled); unlock(); }
              },
            }, runtimeStop);
            if (!started.ok) throw Object.assign(new Error(started.error.message), { code: started.error.code });
            destination = started.value;
            return destination.runtime;
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
        const close = () => closing ??= (async () => {
          deliberatelyClosing = true;
          try { await destination?.close(); }
          finally { stop.abort(new Error('Instance stopped')); await done; }
          if (activity) stops.get(configuration.directory)?.closed(activity);
          bindingControl?.close(); await unlock(); })();
        return success({ sessionId: destination.runtime.sessionId, signal: stop.signal, attachment: destination.attachment,
          attachments: destination.attachments, contexts: destination.contexts, nativeState: destination.nativeState, resume: destination.resume,
          control: bindingControl.control, close });
      } catch (error) {
        report(error); stop.abort(error); await done; await destination?.close();
        if (activity) stops.get(configuration.directory)?.closed(activity);
        bindingControl?.close(); await release?.();
        const parsed = errorCode(error && typeof error === 'object' && 'code' in error ? error.code : undefined);
        return failure(parsed.ok ? parsed.value : 'native', error instanceof Error ? error.message : 'Instance startup failed');
      }
    },
    async remove(configuration, instance) {
      try {
        const loaded = loadBinding(configuration);
        if (!loaded.ok) return loaded;
        const binding = loaded.value, identity = binding.identities.find(item => item.instanceKey === instance.key);
        if (!identity) return success(undefined);
        const confirmed = await stops.get(configuration.directory)?.confirm(identity.agentId); if (confirmed && !confirmed.ok) return confirmed;
        if (!binding.fleetId || !binding.controllerCredential) return failure('forbidden', 'Fleet controller credential is missing');
        const client = createClient({ origin: binding.server, token: binding.controllerCredential });
        const current = await client.call(operations.fleet, { fleetId: binding.fleetId }, {});
        if (!current.ok) return current;
        const removed = await client.call(operations.removeFleetAgent, { fleetId: binding.fleetId, agentId: identity.agentId }, { expectedRevision: current.value.data.revision, instanceKey: instance.key });
        if (!removed.ok) return removed;
        stops.get(configuration.directory)?.forget(identity.agentId);
        saveBinding(configuration.directory, { ...binding, request: null });
        return success(undefined);
      } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Could not retire instance registration'); }
    },
    async update(configuration, instance, releaseDirectory, signal) {
      let listener: (() => Promise<void>) | undefined, receiver: (() => Promise<void>) | undefined;
      try {
        signal.throwIfAborted();
        const stateDirectory = privateDir(join(configuration.directory, instance.workarea)), local = paths(stateDirectory, instance.key);
        listener = await acquireProcessLock(join(local.state, 'listener'));
        receiver = await acquireProcessLock(join(local.state, 'receiver'));
        const software = await installSoftware(local.root, releaseDirectory);
        signal.throwIfAborted(); software.activate();
        return success(undefined);
      } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Could not install the explicitly requested agent software'); }
      finally { await receiver?.(); await listener?.(); }
    },
    async archive(configuration) {
      for (const instance of configuration.roster.instances) {
        const loaded = loadBinding(configuration); if (!loaded.ok) return loaded;
        const identity = loaded.value.identities.find(item => item.instanceKey === instance.key);
        if (identity) { const confirmed = await stops.get(configuration.directory)?.confirm(identity.agentId); if (confirmed && !confirmed.ok) return confirmed; }
      }
      try {
        const loaded = loadBinding(configuration); if (!loaded.ok) return loaded;
        const binding = loaded.value;
        if (!binding.fleetId) return success(undefined);
        if (!binding.controllerCredential) return failure('forbidden', 'Fleet controller credential is missing');
        const client = createClient({ origin: binding.server, token: binding.controllerCredential });
        const current = await client.call(operations.fleet, { fleetId: binding.fleetId }, {}); if (!current.ok) return current;
        const archived = await client.call(operations.archiveFleet, { fleetId: binding.fleetId }, { expectedRevision: current.value.data.revision });
        return archived.ok ? success(undefined) : archived;
      } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Could not archive the stopped fleet registration'); }
    },
  };
}
