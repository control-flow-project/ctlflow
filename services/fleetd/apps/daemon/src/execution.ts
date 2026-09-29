import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { failure, success } from '@crossfire/kernel/result';
import { codexRuntime } from '@crossfire/adapter-codex/owned';
import type { OwnedRuntimeAdapter } from '@crossfire/agent-core/owned-runtime';
import type { RuntimeConnection } from '@crossfire/agent-core/runtime';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { prepareProject, paths } from '@crossfire/adapter-filesystem/project';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
import { privateDir, writeJson } from '@crossfire/adapter-filesystem/index';
import { installSoftware } from '@crossfire/adapter-crossfire/software';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { createClient } from '@crossfire/adapter-crossfire/client';
import { operations } from '@crossfire/contracts/rest/operations';
import { MAX_UPLOAD_BYTES } from '@crossfire/contracts/client';
import { loadBinding, saveBinding, protectFleet } from '@fleetd/storage/binding';
import type { Execution } from '@fleetd/domain/port';
import { prepareEnrollment } from './enrollment.js';

export function createExecution(adapters: Record<string, OwnedRuntimeAdapter> = { codex: codexRuntime() }): Execution {
  return {
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
    async start(configuration, instance, signal) {
      let release: (() => Promise<void>) | undefined, destination: RuntimeConnection | undefined;
      let done: Promise<void> | undefined;
      const stop = new AbortController(), lifetime = AbortSignal.any([signal, stop.signal]);
      try {
        const loaded = loadBinding(configuration);
        if (!loaded.ok) return loaded;
        const binding = loaded.value, identity = binding.identities.find(item => item.instanceKey === instance.key);
        if (!identity) return failure('missing', 'Instance has no enrolled identity');
        const definition = configuration.definitions[instance.definition]!;
        const adapter = adapters[definition.runtime];
        if (!adapter) return failure('invalid', 'Unsupported runtime: ' + definition.runtime);
        const workspace = privateDir(join(configuration.directory, instance.workarea));
        prepareProject(workspace);
        const local = paths(workspace, instance.name);
        release = await acquireProcessLock(join(local.state, 'listener'));
        const software = await installSoftware(local.root, binding.server);
        const client = createClient({ origin: binding.server, token: identity.account.access_token, signal: lifetime });
        const health = await client.call(operations.health, {}, {});
        if (!health.ok) { await release(); return health; }
        const settings = { instance: health.value.data.instance, homeserver: binding.server, server_name: binding.owner.slice(binding.owner.indexOf(':') + 1), owner: binding.owner, max_upload_bytes: MAX_UPLOAD_BYTES };
        writeJson(local.profile, { id: identity.agentId, workspace, account: identity.account, settings });
        software.activate();
        const instructions = [definition.instructions, 'Crossfire identity: ' + instance.name + '. This instance is already enrolled and its listener is managed by the fleet controller. Do not reconnect, enroll or start another listener.',
          'Use node .crossfire/client.mjs --profile ' + instance.name + ' for intentional Matrix replies and attachments. Connection and telemetry require no model action.', readFileSync(software.skill.path, 'utf8')].join('\n\n');
        let ready!: () => void, rejectReady!: (error: unknown) => void;
        const readiness = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
        done = listen({ settings, account: identity.account, id: identity.agentId, coordination: createCoordination({ origin: binding.server, token: identity.account.access_token }),
          release: software.manifest, cursorFile: local.cursors, limit: 100, pollMs: 10000, debounceMs: 1000, reconcileMs: 30000,
          ...(configuration.roster.coordination.approval_room ? { approvalRoom: configuration.roster.coordination.approval_room } : {}), ready,
          runtime: async (runtimeStop, _poll, hooks) => {
            const started = await adapter.start({ name: instance.name, workspace, instructions, options: definition.options, hooks }, runtimeStop);
            if (!started.ok) throw new Error(started.error.message);
            destination = started.value; return destination;
          },
        }, lifetime).then(() => { const error = new Error('Listener ended'); rejectReady(error); stop.abort(error); }, error => { rejectReady(error); stop.abort(error); });
        await readiness;
        if (!destination) throw new Error('Runtime did not report its session');
        let closing: Promise<void> | undefined;
        const unlock = release;
        const close = () => closing ??= (async () => { stop.abort(new Error('Instance stopped')); await done; await destination?.close(); await unlock(); })();
        return success({ sessionId: destination.sessionId, signal: stop.signal, close });
      } catch (error) { stop.abort(error); await done; await destination?.close(); await release?.(); return failure('native', error instanceof Error ? error.message : 'Instance startup failed'); }
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
