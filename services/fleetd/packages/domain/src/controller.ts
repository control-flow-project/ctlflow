import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services, Running } from './port.js';
import type { RuntimeAttachment } from '@crossfire/agent-core/terminal';
import type { Configuration, Registration, FleetState, InstanceState, Operation, OperationInput, Instance } from './model.js';

export function createController(services: Services) {
  const initial = services.registry.registrations(), history = services.registry.operations();
  if (!initial.ok) return initial;
  if (!history.ok) return history;
  let records = initial.value;
  let operations = history.value.map(operation => ['succeeded', 'failed'].includes(operation.status) ? operation : {
    ...operation, status: 'failed' as const, completedAt: services.now(), errors: [{ instanceKey: null, code: 'unavailable', message: 'Controller stopped before this operation completed; inspect and retry explicitly' }],
  });
  const saved = services.registry.saveOperations(operations);
  if (!saved.ok) return saved;
  const states = new Map<string, InstanceState>(), running = new Map<string, Running>();
  const active = new Map<string, { stop: AbortController; done: Promise<void> }>();
  const deployed = new Map<string, Configuration>(), mutations = new Map<string, Promise<void>>();
  const lifetime = new AbortController();
  let stopping = false;
  const startedAt = services.now();
  const key = (fleetId: string, instanceKey: string) => fleetId + ':' + instanceKey;
  function persist(next: Registration[]): Result<void> {
    const result = services.registry.saveRegistrations(next);
    if (result.ok) records = next;
    return result;
  }
  function inspect(fleetId: string): Result<{ record: Registration; configuration: Configuration }> {
    const record = records.find(item => item.fleetId === fleetId);
    if (!record) return failure('missing', 'Fleet is not registered');
    const deployedConfiguration = deployed.get(fleetId);
    if (deployedConfiguration && (active.has(fleetId) || [...running.keys()].some(value => value.startsWith(fleetId + ':')))) return success({ record, configuration: deployedConfiguration });
    const configuration = services.registry.load(record.directory);
    if (!configuration.ok) return configuration;
    if (configuration.value.roster.fleet !== record.fleetKey) return failure('conflict', 'A registered fleet key cannot change');
    if (configuration.value.digest !== record.digest) {
      if (active.has(fleetId) || [...running.keys()].some(value => value.startsWith(fleetId + ':'))) return failure('conflict', 'Fleet files changed while active; stop it before applying edits');
      const next = { ...record, digest: configuration.value.digest, revision: record.revision + 1 };
      const changed = persist(records.map(item => item === record ? next : item));
      if (!changed.ok) return changed;
      return success({ record: next, configuration: configuration.value });
    }
    return success({ record, configuration: configuration.value });
  }
  function view(fleetId: string): Result<FleetState> {
    const current = inspect(fleetId);
    if (!current.ok) return current;
    const { record, configuration } = current.value;
    const instances = configuration.roster.instances.map(instance => states.get(key(fleetId, instance.key)) ?? { instance, phase: 'stopped' as const, sessionId: null, error: null, startedAt: null });
    const phase = instances.find(instance => instance.phase === 'stopping')?.phase ?? instances.find(instance => instance.phase === 'awaiting-approval')?.phase
      ?? instances.find(instance => instance.phase === 'starting')?.phase ?? instances.find(instance => instance.phase === 'failed')?.phase
      ?? instances.find(instance => instance.phase === 'running')?.phase ?? 'stopped';
    return success({ fleetId, fleetKey: record.fleetKey, label: record.label, directory: record.directory, revision: record.revision,
      controller: services.controller, instances, phase, error: null });
  }
  function list(): Result<FleetState[]> {
    const values: FleetState[] = [];
    for (const record of records.toSorted((left, right) => left.fleetKey.localeCompare(right.fleetKey))) {
      const result = view(record.fleetId);
      values.push(result.ok ? result.value : { ...record, controller: services.controller, phase: 'failed', error: result.error.message, instances: [] });
    }
    return success(values);
  }
  function attachment(fleetId: string, instanceKey: string): Result<RuntimeAttachment> {
    const current = view(fleetId);
    if (!current.ok) return current;
    const instance = current.value.instances.find(value => value.instance.key === instanceKey);
    if (!instance) return failure('missing', 'Instance not found');
    const runtime = running.get(key(fleetId, instanceKey));
    if (stopping || instance.phase !== 'running' || !runtime || runtime.signal.aborted) return failure('conflict', 'Start this agent before attaching its terminal');
    return success(structuredClone(runtime.attachment));
  }
  function add(directory: string): Result<FleetState> {
    if (stopping) return failure('unavailable', 'Controller is stopping');
    const configuration = services.registry.load(directory);
    if (!configuration.ok) return configuration;
    const valid = services.execution.validate(configuration.value);
    if (!valid.ok) return valid;
    if (records.some(record => record.directory === directory || record.fleetKey === configuration.value.roster.fleet)) return failure('conflict', 'Fleet directory or key is already registered');
    if (records.length >= 100) return failure('capacity', 'Controller supports at most 100 registered fleets');
    const record = { fleetId: services.id(), fleetKey: configuration.value.roster.fleet, label: configuration.value.roster.fleet, directory, revision: 0, digest: configuration.value.digest };
    const result = persist([...records, record]);
    return result.ok ? view(record.fleetId) : result;
  }
  function mutable(fleetId: string, revision: number) {
    if (stopping) return failure('unavailable', 'Controller is stopping');
    if (mutations.has(fleetId)) return failure('conflict', 'A roster change is in progress');
    const current = inspect(fleetId);
    if (!current.ok) return current;
    if (current.value.record.revision !== revision) return failure('stale_revision', 'Refresh the fleet before changing it');
    if (active.has(fleetId) || [...running.keys()].some(value => value.startsWith(fleetId + ':'))) return failure('conflict', 'Stop this fleet before changing its registry or roster');
    return current;
  }
  function rename(fleetId: string, revision: number, label: string): Result<FleetState> {
    const current = mutable(fleetId, revision);
    if (!current.ok) return current;
    const changed = persist(records.map(record => record.fleetId === fleetId ? { ...record, label, revision: revision + 1 } : record));
    return changed.ok ? view(fleetId) : changed;
  }
  function remove(fleetId: string, revision: number): Result<void> {
    const current = mutable(fleetId, revision);
    return current.ok ? persist(records.filter(record => record.fleetId !== fleetId)) : current;
  }
  async function editInstance(fleetId: string, revision: number, action: { kind: 'add'; instance: Instance } | { kind: 'remove'; instanceKey: string } | { kind: 'definition'; instanceKey: string; definition: string }): Promise<Result<FleetState>> {
    const current = mutable(fleetId, revision);
    if (!current.ok) return current;
    let release!: () => void;
    mutations.set(fleetId, new Promise<void>(resolve => { release = resolve; }));
    try {
    const { configuration } = current.value;
    const existing = configuration.roster.instances.find(instance => instance.key === (action.kind === 'add' ? action.instance.key : action.instanceKey));
    if (action.kind === 'add' && existing) return failure('conflict', 'Instance key is already registered');
    if (action.kind !== 'add' && !existing) return failure('missing', 'Instance does not exist');
    if (action.kind === 'remove') {
      const detached = await services.execution.detach(configuration, existing!);
      if (!detached.ok) return detached;
    }
    const instances = action.kind === 'add' ? [...configuration.roster.instances, action.instance]
      : action.kind === 'remove' ? configuration.roster.instances.filter(instance => instance.key !== action.instanceKey)
      : configuration.roster.instances.map(instance => instance.key === action.instanceKey ? { ...instance, definition: action.definition } : instance);
    const changed = services.registry.writeRoster(configuration, { ...configuration.roster, instances });
    if (!changed.ok) return changed;
    const result = persist(records.map(record => record.fleetId === fleetId ? { ...record, digest: changed.value.digest, revision: revision + 1 } : record));
    if (result.ok) states.delete(key(fleetId, action.kind === 'add' ? action.instance.key : action.instanceKey));
    return result.ok ? view(fleetId) : result;
    } finally { mutations.delete(fleetId); release(); }
  }
  function saveOperation(operation: Operation): void {
    const next = operations.map(item => item.operationId === operation.operationId ? structuredClone(operation) : item);
    const saved = services.registry.saveOperations(next);
    if (!saved.ok) throw new Error(saved.error.message);
    operations = next;
  }
  async function stopInstance(fleetId: string, instance: Instance): Promise<void> {
    const identity = key(fleetId, instance.key), current = running.get(identity);
    if (current) {
      states.set(identity, { ...states.get(identity)!, phase: 'stopping' });
      await current.close(); running.delete(identity);
    }
    states.set(identity, { instance, phase: 'stopped', sessionId: states.get(identity)?.sessionId ?? null, startedAt: null, error: null });
  }
  async function execute(operation: Operation, configuration: Configuration, signal: AbortSignal): Promise<void> {
    const fleetId = operation.target.fleetId!, selected = configuration.roster.instances.filter(instance => operation.target.kind !== 'agent' || instance.key === operation.target.instanceKey);
    operation.status = 'running'; saveOperation(operation);
    try {
      if (operation.action === 'stop') for (const instance of selected) await stopInstance(fleetId, instance);
      else {
        const valid = services.execution.validate(configuration);
        if (!valid.ok) throw new Error(valid.error.message);
        for (const instance of selected) if (!running.has(key(fleetId, instance.key))) states.set(key(fleetId, instance.key), { instance, phase: 'starting', error: null, sessionId: null, startedAt: null });
        const prepared = await services.execution.prepare(configuration, services.controller, signal, approval => {
          operation.status = 'awaiting-approval'; operation.approval = approval; saveOperation(operation);
          for (const instance of selected) if (!running.has(key(fleetId, instance.key))) states.set(key(fleetId, instance.key), { ...states.get(key(fleetId, instance.key))!, phase: 'awaiting-approval' });
        });
        if (!prepared.ok) { operation.errors.push({ instanceKey: null, ...prepared.error }); return; }
        operation.errors.push(...prepared.value.failed);
        operation.status = 'running'; operation.approval = null; saveOperation(operation);
        for (const instance of selected) {
          signal.throwIfAborted();
          const identity = key(fleetId, instance.key);
          if (running.has(identity)) continue;
          const collision = prepared.value.failed.find(failed => failed.instanceKey === instance.key);
          if (collision) { states.set(identity, { instance, phase: 'failed', sessionId: null, startedAt: null, error: collision.message }); continue; }
          const result = await services.execution.start(configuration, instance, AbortSignal.any([signal, lifetime.signal]));
          if (!result.ok) { operation.errors.push({ instanceKey: instance.key, ...result.error }); states.set(identity, { instance, phase: 'failed', error: result.error.message, sessionId: null, startedAt: null }); continue; }
          running.set(identity, result.value);
          states.set(identity, { instance, phase: 'running', sessionId: result.value.sessionId, startedAt: services.now(), error: null });
          const failed = () => {
            const current = states.get(identity);
            if (current?.phase !== 'running') return;
            states.set(identity, { ...current, phase: 'failed', error: 'Listener or runtime disconnected; inspect and explicitly restart' });
            void result.value.close().then(() => running.delete(identity), error => {
              states.set(identity, { ...current, phase: 'failed', error: error instanceof Error ? error.message : 'Runtime cleanup failed' });
            });
          };
          result.value.signal.addEventListener('abort', failed, { once: true });
          if (result.value.signal.aborted) failed();
        }
      }
    } catch (error) { operation.errors.push({ instanceKey: null, code: 'unavailable', message: error instanceof Error ? error.message : 'Operation failed' }); }
    finally {
      if (signal.aborted && operation.action === 'start') for (const instance of selected) await stopInstance(fleetId, instance);
      for (const instance of selected) {
        const identity = key(fleetId, instance.key), state = states.get(identity);
        if (state && ['starting', 'awaiting-approval'].includes(state.phase)) states.set(identity, { ...state, phase: 'failed', error: operation.errors[0]?.message ?? 'Start did not complete' });
      }
      operation.status = operation.errors.length ? 'failed' : 'succeeded'; operation.completedAt = services.now(); operation.approval = null; saveOperation(operation);
    }
  }
  async function operate(input: OperationInput): Promise<Result<Operation>> {
    const existing = operations.find(operation => operation.operationId === input.operationId);
    if (existing) {
      const previous = { operationId: existing.operationId, target: existing.target, action: existing.action, expectedRevision: existing.expectedRevision };
      return previous.action === input.action && previous.expectedRevision === input.expectedRevision && previous.target.kind === input.target.kind
        && previous.target.fleetId === input.target.fleetId && previous.target.instanceKey === input.target.instanceKey ? success(structuredClone(existing)) : failure('conflict', 'Operation ID was used for a different request');
    }
    if (stopping) return failure('unavailable', 'Controller is stopping');
    const target = input.target;
    if (target.kind === 'daemon') {
      if (input.action !== 'stop' || input.expectedRevision !== 0 || target.fleetId !== undefined || target.instanceKey !== undefined) return failure('invalid', 'Daemon supports only an exact stop request');
      const operation: Operation = { ...input, status: 'running', createdAt: services.now(), completedAt: null, approval: null, errors: [] };
      operations.push(operation);
      saveOperation(operation);
      await close();
      operation.status = 'succeeded'; operation.completedAt = services.now(); saveOperation(operation);
      return success(operation);
    }
    if (!target.fleetId || target.kind === 'agent' && !target.instanceKey || target.kind === 'fleet' && target.instanceKey !== undefined) return failure('invalid', 'Invalid lifecycle target');
    if (mutations.has(target.fleetId)) return failure('conflict', 'A roster change is in progress');
    const current = inspect(target.fleetId);
    if (!current.ok) return current;
    if (current.value.record.revision !== input.expectedRevision) return failure('stale_revision', 'Refresh the fleet before starting this operation');
    if (target.kind === 'agent' && !current.value.configuration.roster.instances.some(instance => instance.key === target.instanceKey)) return failure('missing', 'Instance not found');
    if (input.action === 'start' && current.value.configuration.roster.instances.length === 0) return failure('invalid', 'Add an instance before starting this fleet');
    const predecessor = active.get(target.fleetId);
    if (predecessor && input.action !== 'stop') return failure('conflict', 'Another operation is active for this fleet');
    const operation: Operation = { ...input, status: 'accepted', createdAt: services.now(), completedAt: null, approval: null, errors: [] };
    operations = [...operations.filter(item => !['succeeded', 'failed'].includes(item.status)).concat(operations.filter(item => ['succeeded', 'failed'].includes(item.status)).slice(-399)), operation];
    const stored = services.registry.saveOperations(operations);
    if (!stored.ok) { operations = operations.filter(item => item !== operation); return stored; }
    const stop = new AbortController(); predecessor?.stop.abort(new Error('Start cancelled by explicit stop'));
    deployed.set(target.fleetId, current.value.configuration);
    const done = Promise.resolve().then(async () => { await predecessor?.done; await execute(operation, current.value.configuration, stop.signal); }).catch(async error => {
      operation.status = 'failed'; operation.completedAt = services.now(); operation.approval = null;
      operation.errors.push({ instanceKey: null, code: 'unavailable', message: error instanceof Error ? error.message : 'Operation persistence failed' });
      for (const instance of current.value.configuration.roster.instances) {
        try { await stopInstance(target.fleetId!, instance); } catch { lifetime.abort(new Error('Runtime cleanup failed')); }
      }
    }).finally(() => { if (active.get(target.fleetId!)?.stop === stop) active.delete(target.fleetId!); });
    active.set(target.fleetId, { stop, done });
    return success(structuredClone(operation));
  }
  async function close(): Promise<void> {
    stopping = true;
    await Promise.all(mutations.values());
    for (const operation of active.values()) operation.stop.abort(new Error('Controller stopping'));
    await Promise.all([...active.values()].map(operation => operation.done));
    for (const record of records) {
      const configuration = services.registry.load(record.directory);
      if (configuration.ok) for (const instance of configuration.value.roster.instances) await stopInstance(record.fleetId, instance);
    }
    for (const process of running.values()) await process.close();
    running.clear(); lifetime.abort(new Error('Controller stopped'));
  }
  return success({ status: () => ({ controller: services.controller, startedAt, stopping }), list, view, attachment, add, rename, remove, editInstance, operate, close,
    operation(id: string): Result<Operation> { const operation = operations.find(item => item.operationId === id); return operation ? success(structuredClone(operation)) : failure('missing', 'Operation not found'); } });
}
export type FleetController = Extract<ReturnType<typeof createController>, { ok: true }>['value'];
