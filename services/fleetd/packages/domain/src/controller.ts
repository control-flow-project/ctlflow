import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services, Running } from './port.js';
import type { RuntimeAttachment } from '@ctlflow/crossfire-agent-core/terminal';
import { canRecoverFailure, isListenerStop } from '@ctlflow/crossfire-kernel/lifecycle';
import type { Configuration, Registration, FleetState, InstanceState, Operation, OperationInput, Instance, RetainedContext } from './model.js';
import { createSetup } from './setup.js';
import { createResumeSelections } from './resume-selection.js';

export function createController(services: Services) {
  const initial = services.registry.registrations(), history = services.registry.operations(), intent = services.registry.desiredIntent();
  if (!initial.ok) return initial;
  if (!history.ok) return history;
  if (!intent.ok) return intent;
  const selections = createResumeSelections(services.registry, initial.value);
  if (!selections.ok) return selections;
  const resuming = selections.value;
  if (intent.value.some(item => !initial.value.some(record => record.fleetId === item.fleetId))) return failure('invalid', 'Desired binding references an unregistered fleet');
  let records = initial.value;
  let operations = history.value.map(operation => ['succeeded', 'failed'].includes(operation.status) ? operation : {
    ...operation, status: 'failed' as const, completedAt: services.now(), errors: [{ instanceKey: null, code: 'unavailable', message: 'Controller stopped before this operation completed; inspect and retry explicitly' }],
  });
  const saved = services.registry.saveOperations(operations);
  if (!saved.ok) return saved;
  const states = new Map<string, InstanceState>(), running = new Map<string, Running>();
  const active = new Map<string, { stop: AbortController; done: Promise<void> }>();
  const deployed = new Map<string, Configuration>(), mutations = new Map<string, Promise<void>>();
  const wanted = new Map(intent.value.map(item => [item.fleetId + ':' + item.instanceKey, item])), recovering = new Map<string, { stop: AbortController; done: Promise<void> }>();
  const restorationOwned = new Set(wanted.keys());
  const lifetime = new AbortController();
  const restoring = new Map<string, Promise<void>>();
  const connectionErrors = new Map<string, string>();
  let stopping = false;
  const startedAt = services.now();
  function connect(configuration: Configuration): void {
    const result = services.execution.connect(configuration, lifetime.signal, { execute: async input => {
      const record = records.find(item => item.directory === configuration.directory);
      if (!record) return failure('missing', 'This fleet is no longer registered');
      const previous = operations.find(operation => operation.operationId === input.operationId);
      for (const completed of operations.filter(operation => operation.target.fleetId === record.fleetId && operation.operationId !== input.operationId
        && operation.receiptPending && operation.completedAt !== null)) {
        const acknowledged = acknowledgeOperation(completed.operationId); if (!acknowledged.ok) return acknowledged;
      }
      const requested = await operate({ operationId: input.operationId, action: input.action,
        target: input.instanceKey === null ? { kind: 'fleet', fleetId: record.fleetId } : { kind: 'agent', fleetId: record.fleetId, instanceKey: input.instanceKey },
        expectedRevision: previous?.expectedRevision ?? record.revision }, true);
      if (!requested.ok) return requested;
      if (requested.value.completedAt === null) await active.get(record.fleetId)?.done;
      const completed = operations.find(operation => operation.operationId === input.operationId);
      if (!completed || completed.completedAt === null) return failure('unavailable', 'The native session operation did not complete');
      return success({ status: completed.status === 'succeeded' ? 'succeeded' as const : 'failed' as const,
        errorMessage: completed.status === 'succeeded' ? null : completed.errors.map(error => (error.instanceKey ? error.instanceKey + ': ' : '') + error.message).join('; ').slice(0, 4096) || 'Native session operation failed' });
    }, acknowledged: acknowledgeOperation });
    if (!result.ok) connectionErrors.set(configuration.directory, result.error.message);
    else connectionErrors.delete(configuration.directory);
  }
  for (const record of records) {
    const configuration = services.registry.load(record.directory);
    if (configuration.ok) connect(configuration.value);
  }
  const key = (fleetId: string, instanceKey: string) => fleetId + ':' + instanceKey;
  const executing = (fleetId: string) => active.has(fleetId) || [...running.keys(), ...wanted.keys()].some(value => value.startsWith(fleetId + ':'));
  function changeIntent(fleetId: string, instanceKeys: string[], enabled: boolean): Result<void> {
    const next = new Map(wanted);
    for (const instanceKey of instanceKeys) {
      const identity = key(fleetId, instanceKey);
      if (enabled) next.set(identity, { fleetId, instanceKey });
      else next.delete(identity);
    }
    const saved = services.registry.saveDesiredIntent([...next.values()]);
    if (!saved.ok) return saved;
    wanted.clear(); for (const [identity, item] of next) wanted.set(identity, item);
    return success(undefined);
  }
  function persist(next: Registration[]): Result<void> {
    const result = services.registry.saveRegistrations(next);
    if (result.ok) records = next;
    return result;
  }
  function inspect(fleetId: string): Result<{ record: Registration; configuration: Configuration }> {
    const record = records.find(item => item.fleetId === fleetId);
    if (!record) return failure('missing', 'Fleet is not registered');
    const deployedConfiguration = deployed.get(fleetId);
    if (deployedConfiguration && executing(fleetId)) return success({ record, configuration: deployedConfiguration });
    const configuration = services.registry.load(record.directory);
    if (!configuration.ok) return configuration;
    if (configuration.value.roster.fleet !== record.fleetKey) return failure('conflict', 'A registered fleet key cannot change');
    return success({ record, configuration: configuration.value });
  }
  function view(fleetId: string): Result<FleetState> {
    const current = inspect(fleetId);
    if (!current.ok) return current;
    const { record, configuration } = current.value;
    const instances = configuration.roster.instances.map(instance => {
      const state = states.get(key(fleetId, instance.key)) ?? { instance, phase: 'stopped' as const, sessionId: null, error: null, startedAt: null };
      const runtime = running.get(key(fleetId, instance.key));
      const native = runtime && !runtime.signal.aborted ? runtime.nativeState() : null;
      const phase = state.phase === 'running' && native ? native.phase : state.phase;
      return { ...state, instance, phase, listenerActive: !!runtime && !runtime.signal.aborted && runtime.control.current().active,
        desiredActive: wanted.has(key(fleetId, instance.key)), lastActivityAt: native?.lastActivityAt ?? null, historyAvailable: native?.historyAvailable ?? null };
    });
    const phase = instances.find(instance => instance.phase === 'stopping')?.phase ?? instances.find(instance => instance.phase === 'awaiting-approval')?.phase
      ?? instances.find(instance => instance.phase === 'starting')?.phase ?? instances.find(instance => instance.phase === 'failed')?.phase
      ?? instances.find(instance => instance.phase === 'waking')?.phase ?? instances.find(instance => instance.phase === 'running')?.phase
      ?? instances.find(instance => instance.phase === 'sleeping')?.phase ?? 'stopped';
    return success({ fleetId, fleetKey: record.fleetKey, label: record.label, directory: record.directory, revision: record.revision,
      resumeInstanceKeys: resuming.view(fleetId),
      controller: services.controller, instances, phase, connection: services.execution.connection(configuration), error: connectionErrors.get(configuration.directory) ?? null });
  }
  function list(): Result<FleetState[]> {
    const values: FleetState[] = [];
    for (const record of records.toSorted((left, right) => left.fleetKey.localeCompare(right.fleetKey))) {
      const result = view(record.fleetId);
      values.push(result.ok ? result.value : { ...record, controller: services.controller, phase: 'failed', error: result.error.message, instances: [], resumeInstanceKeys: resuming.view(record.fleetId),
        connection: { connected: false, deliveryEnabled: false, revision: null, error: result.error.message } });
    }
    return success(values);
  }
  async function attachment(fleetId: string, instanceKey: string, context?: string): Promise<Result<RuntimeAttachment>> {
    const current = view(fleetId);
    if (!current.ok) return current;
    const instance = current.value.instances.find(value => value.instance.key === instanceKey);
    if (!instance) return failure('missing', 'Instance not found');
    const runtime = running.get(key(fleetId, instanceKey));
    if (stopping || !runtime || runtime.signal.aborted) return failure('conflict', 'Resume this agent before attaching its terminal; reading a pointer never starts a session');
    if (context === undefined) {
      const pointer = await runtime.attachment();
      return pointer.ok ? success(structuredClone(pointer.value)) : pointer;
    }
    const pointers = await runtime.attachments();
    if (!pointers.ok) return pointers;
    const selected = pointers.value.find(item => item.context === context);
    return selected ? success(structuredClone(selected.attachment)) : failure('missing', 'Retained native history not found; attaching never creates one');
  }
  async function contexts(fleetId: string, instanceKey: string): Promise<Result<RetainedContext[]>> {
    const current = inspect(fleetId);
    if (!current.ok) return current;
    const instance = current.value.configuration.roster.instances.find(item => item.key === instanceKey);
    if (!instance) return failure('missing', 'Instance not found');
    const runtime = running.get(key(fleetId, instanceKey));
    const metadata = runtime && !runtime.signal.aborted ? await runtime.contexts() : await services.execution.contexts(current.value.configuration, instance);
    return metadata.ok ? success(structuredClone(metadata.value)) : metadata;
  }
  async function test(fleetId: string): Promise<Result<void>> {
    const current = inspect(fleetId); if (!current.ok) return current;
    const fleet = view(fleetId); if (!fleet.ok) return fleet;
    if (stopping || !fleet.value.connection.connected || !fleet.value.connection.deliveryEnabled || fleet.value.error) return failure('conflict', 'Controller delivery is not ready');
    const selected = fleet.value.instances.filter(instance => instance.desiredActive);
    if (!selected.length) return failure('conflict', 'This fleet is stopped; reading readiness never starts sessions');
    for (const instance of selected) {
      if (!instance.listenerActive || !instance.sessionId || !['running', 'sleeping'].includes(instance.phase) || instance.error) return failure('conflict', 'Instance ' + instance.instance.key + ' has no ready listener/native binding');
      const tested = await services.execution.test(current.value.configuration, instance.instance);
      if (!tested.ok) return failure(tested.error.code, instance.instance.key + ': ' + tested.error.message);
    }
    return success(undefined);
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
    if (result.ok) connect(configuration.value);
    return result.ok ? view(record.fleetId) : result;
  }
  const setup = createSetup({ registry: services.registry, signal: lifetime.signal, id: services.id, stopping: () => stopping,
    registered: directory => records.find(record => record.directory === directory), restoring: fleetId => restoring.get(fleetId),
    inspect: services.execution.inspect, add, view, test, operations: () => operations, operate });
  function mutable(fleetId: string, revision: number) {
    if (stopping) return failure('unavailable', 'Controller is stopping');
    if (mutations.has(fleetId)) return failure('conflict', 'A roster change is in progress');
    const current = inspect(fleetId);
    if (!current.ok) return current;
    if (current.value.record.revision !== revision) return failure('stale_revision', 'Refresh the fleet before changing it');
    if (executing(fleetId)) return failure('conflict', 'Stop this fleet before changing its registry or roster');
    return current;
  }
  function rename(fleetId: string, revision: number, label: string): Result<FleetState> {
    const current = mutable(fleetId, revision);
    if (!current.ok) return current;
    const changed = persist(records.map(record => record.fleetId === fleetId ? { ...record, label, revision: revision + 1 } : record));
    return changed.ok ? view(fleetId) : changed;
  }
  async function remove(fleetId: string, revision: number): Promise<Result<void>> {
    const current = mutable(fleetId, revision);
    if (!current.ok) return current;
    let release!: () => void;
    mutations.set(fleetId, new Promise<void>(resolve => { release = resolve; }));
    try {
      const archived = await services.execution.archive(current.value.configuration); if (!archived.ok) return archived;
      const forgotten = resuming.forget(fleetId); if (!forgotten.ok) return forgotten;
      const removed = persist(records.filter(record => record.fleetId !== fleetId));
      if (removed.ok) {
        await services.execution.disconnect(current.value.configuration); connectionErrors.delete(current.value.configuration.directory); deployed.delete(fleetId);
        for (const identity of states.keys()) if (identity.startsWith(fleetId + ':')) states.delete(identity);
      }
      return removed;
    } finally { mutations.delete(fleetId); release(); }
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
      const removed = await services.execution.remove(configuration, existing!);
      if (!removed.ok) return removed;
      const forgotten = resuming.forget(fleetId, action.instanceKey); if (!forgotten.ok) return forgotten;
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
  function acknowledgeOperation(operationId: string): Result<void> {
    const operation = operations.find(item => item.operationId === operationId);
    if (!operation || operation.completedAt === null) return failure('conflict', 'Only completed native operations can release their receipt pin');
    try {
      const { receiptPending: _pending, ...completed } = operation; saveOperation(completed);
      return success(undefined);
    } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Session receipt persistence failed'); }
  }
  async function stopInstance(fleetId: string, instance: Instance): Promise<void> {
    const identity = key(fleetId, instance.key);
    restorationOwned.delete(identity);
    const recovery = recovering.get(identity);
    recovery?.stop.abort(new Error('Automatic recovery cancelled by explicit stop'));
    await recovery?.done;
    const current = running.get(identity);
    if (current) {
      states.set(identity, { ...states.get(identity)!, phase: 'stopping' });
      await current.close(); running.delete(identity);
    }
    states.set(identity, { instance, phase: 'stopped', sessionId: states.get(identity)?.sessionId ?? null, startedAt: null, error: null });
  }
  async function stopSelected(operation: Operation, selected: Instance[]): Promise<void> {
    const fleetId = operation.target.fleetId!;
    for (const instance of selected) {
      try { await stopInstance(fleetId, instance); }
      catch (error) {
        const message = (error instanceof Error ? error.message : 'Native process cleanup failed').replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 4096);
        operation.errors.push({ instanceKey: instance.key, code: 'unavailable', message });
        const current = states.get(key(fleetId, instance.key));
        states.set(key(fleetId, instance.key), { instance, phase: 'failed', sessionId: current?.sessionId ?? null, startedAt: current?.startedAt ?? null, error: message });
      }
    }
  }
  async function discardRuntime(fleetId: string, instance: Instance, runtime: Running): Promise<void> {
    const identity = key(fleetId, instance.key);
    running.set(identity, runtime);
    await runtime.close();
    if (running.get(identity) === runtime) running.delete(identity);
  }
  function recover(fleetId: string, configuration: Configuration, instance: Instance, reason: unknown, runtime?: Running): void {
    const identity = key(fleetId, instance.key);
    const detail = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason
      : reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' ? reason.message : 'Listener binding disconnected';
    const message = detail.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 4096);
    const intentional = isListenerStop(reason);
    const intentSaved = intentional && !stopping ? changeIntent(fleetId, [instance.key], false) : success(undefined);
    states.set(identity, { ...states.get(identity)!, phase: intentional ? 'stopping' : 'failed', error: intentional ? null : message });
    const stop = new AbortController(), signal = AbortSignal.any([stop.signal, lifetime.signal]);
    const done = Promise.resolve().then(async () => {
      let cleaned = false;
      try { await runtime?.close(); cleaned = true; }
      catch (error) {
        const cleanup = error instanceof Error ? error.message : 'Runtime cleanup failed';
        states.set(identity, { ...states.get(identity)!, phase: 'failed', error: (message + '; cleanup: ' + cleanup).slice(0, 4096) });
        return;
      } finally { if (cleaned && runtime && running.get(identity) === runtime) running.delete(identity); }
      if (intentional) { states.set(identity, { ...states.get(identity)!, phase: intentSaved.ok ? 'stopped' : 'failed', startedAt: null, error: intentSaved.ok ? null : intentSaved.error.message }); return; }
      if (!canRecoverFailure(reason)) return;
      for (let attempt = 0; wanted.has(identity) && !signal.aborted && !stopping; attempt++) {
        await services.delay(Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)), signal);
        if (signal.aborted || !wanted.has(identity) || stopping) return;
        if (active.has(fleetId) || mutations.has(fleetId)) continue;
        let result: Result<Running>;
        try { result = await services.execution.start(configuration, instance, signal, 'recovery'); }
        catch (error) {
          if (signal.aborted || !wanted.has(identity)) return;
          states.set(identity, { ...states.get(identity)!, error: (error instanceof Error ? error.message : 'Binding recovery failed').slice(0, 4096) });
          if (!canRecoverFailure(error)) return;
          continue;
        }
        if (signal.aborted || !wanted.has(identity)) { if (result.ok) await discardRuntime(fleetId, instance, result.value); return; }
        if (!result.ok) {
          states.set(identity, { ...states.get(identity)!, error: result.error.message });
          if (!canRecoverFailure(result.error)) return;
          continue;
        }
        recovering.delete(identity);
        launched(fleetId, configuration, instance, result.value); return;
      }
    }).catch(error => { if (!signal.aborted) states.set(identity, { ...states.get(identity)!, phase: 'failed', error: error instanceof Error ? error.message : 'Recovery failed' }); })
      .finally(() => { if (recovering.get(identity)?.stop === stop) recovering.delete(identity); });
    recovering.set(identity, { stop, done });
  }
  function launched(fleetId: string, configuration: Configuration, instance: Instance, runtime: Running): void {
    const identity = key(fleetId, instance.key);
    running.set(identity, runtime);
    states.set(identity, { instance, phase: 'running', sessionId: runtime.sessionId, startedAt: services.now(), error: null });
    const failed = () => {
      if (running.get(identity) === runtime && states.get(identity)?.phase === 'running') recover(fleetId, configuration, instance, runtime.signal.reason, runtime);
    };
    runtime.signal.addEventListener('abort', failed, { once: true });
    if (runtime.signal.aborted) failed();
  }
  async function restoreOne(record: Registration, instance: Instance, configuration: Configuration): Promise<void> {
    const identity = key(record.fleetId, instance.key), stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, lifetime.signal]), timer = new AbortController();
    let observed!: () => void;
    const attempted = new Promise<void>(resolve => { observed = resolve; });
    states.set(identity, { instance, phase: 'starting', sessionId: null, error: null, startedAt: null });
    const done = Promise.resolve().then(async () => {
      const started = services.execution.start(configuration, instance, signal, 'recovery').then(async result => {
        if (!result.ok) return result;
        if (signal.aborted || stopping || !wanted.has(identity) || !restorationOwned.has(identity)) {
          try { await discardRuntime(record.fleetId, instance, result.value); }
          catch (error) { return failure('conflict', error instanceof Error ? error.message : 'Cancelled native generation cleanup failed'); }
          return failure('unavailable', 'Binding restoration cancelled');
        }
        return result;
      });
      const timeout = services.delay(30000, AbortSignal.any([timer.signal, signal])).then(() => {
        if (!timer.signal.aborted && !signal.aborted) stop.abort(new Error('Binding restoration exceeded its 30-second deadline'));
        return failure('unavailable', signal.reason instanceof Error ? signal.reason.message : 'Binding restoration cancelled');
      });
      const result = await Promise.race([started, timeout]); timer.abort();
      if (!result.ok && signal.aborted) {
        if (restorationOwned.has(identity) && !stopping && wanted.has(identity)) states.set(identity, { ...states.get(identity)!, phase: 'failed', error: result.error.message });
        observed();
        const settled = await started;
        if (!settled.ok && !canRecoverFailure(settled.error)) {
          if (restorationOwned.has(identity)) states.set(identity, { ...states.get(identity)!, phase: 'failed', error: settled.error.message }); return;
        }
      }
      if (recovering.get(identity)?.stop === stop) recovering.delete(identity);
      if (stopping || !wanted.has(identity) || !restorationOwned.has(identity)) return;
      if (result.ok) launched(record.fleetId, configuration, instance, result.value);
      else recover(record.fleetId, configuration, instance, result.error);
    }).catch(error => {
      if (restorationOwned.has(identity) && !stopping && wanted.has(identity)) recover(record.fleetId, configuration, instance, error);
    }).finally(() => { restorationOwned.delete(identity); timer.abort(); observed(); if (recovering.get(identity)?.stop === stop) recovering.delete(identity); });
    recovering.set(identity, { stop, done });
    await attempted;
  }
  async function restore(): Promise<void> {
    const tasks: { record: Registration; instance: Instance; configuration: Configuration; observed(): void }[] = [];
    const completions: (() => void)[] = [];
    try {
      for (const record of records) {
        const desired = [...wanted.values()].filter(item => item.fleetId === record.fleetId);
        if (!desired.length) continue;
        const configuration = services.registry.load(record.directory);
        if (!configuration.ok) { connectionErrors.set(record.directory, configuration.error.message); continue; }
        const configured = configuration.value.roster.instances.filter(instance => wanted.has(key(record.fleetId, instance.key)));
        const selected = configured.filter(instance => restorationOwned.has(key(record.fleetId, instance.key)));
        const valid = services.execution.validate(configuration.value);
        const error = configured.length !== desired.length ? 'Desired binding is missing from the saved roster; stop this fleet and review its files'
          : configuration.value.roster.fleet !== record.fleetKey || configuration.value.digest !== record.digest
            ? 'Fleet files changed after their last accepted revision; review them and run an explicit update' : !valid.ok ? valid.error.message : null;
        if (error) {
          connectionErrors.set(record.directory, error);
          for (const instance of selected) states.set(key(record.fleetId, instance.key), { instance, phase: 'failed', sessionId: null, startedAt: null, error });
          continue;
        }
        if (!selected.length) continue;
        deployed.set(record.fleetId, configuration.value);
        let complete!: () => void, remaining = selected.length;
        const pending = new Promise<void>(resolve => { complete = resolve; });
        restoring.set(record.fleetId, pending);
        const finish = () => { if (restoring.get(record.fleetId) === pending) restoring.delete(record.fleetId); complete(); };
        const observed = () => { if (--remaining === 0) finish(); };
        completions.push(finish);
        for (const instance of selected) {
          states.set(key(record.fleetId, instance.key), { instance, phase: 'starting', sessionId: null, startedAt: null, error: null });
          tasks.push({ record, instance, configuration: configuration.value, observed });
        }
      }
      let position = 0;
      await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
        for (;;) {
          const task = tasks[position++];
          if (!task) return;
          try { if (!stopping && wanted.has(key(task.record.fleetId, task.instance.key)) && restorationOwned.has(key(task.record.fleetId, task.instance.key))) await restoreOne(task.record, task.instance, task.configuration); }
          finally { task.observed(); }
        }
      }));
    } finally { for (const complete of completions) complete(); }
  }
  const restoration = Promise.resolve().then(restore).catch(error => {
    const message = error instanceof Error ? error.message : 'Controller restoration failed';
    for (const record of records) if ([...wanted.values()].some(item => item.fleetId === record.fleetId)) {
      connectionErrors.set(record.directory, message);
      for (const [identity, state] of states) if (identity.startsWith(record.fleetId + ':') && state.phase === 'starting') states.set(identity, { ...state, phase: 'failed', error: message });
    }
  });
  async function execute(operation: Operation, configuration: Configuration | null, selected: Instance[], signal: AbortSignal): Promise<void> {
    const fleetId = operation.target.fleetId!;
    operation.status = 'running'; saveOperation(operation);
    try {
      if (operation.action === 'stop') {
        await stopSelected(operation, selected);
        if (configuration) for (const instance of selected) {
          if (operation.errors.some(error => error.instanceKey === instance.key)) continue;
          const receipt = await services.execution.confirmStopped(configuration, instance);
          if (!receipt.ok) {
            operation.errors.push({ instanceKey: instance.key, ...receipt.error });
            states.set(key(fleetId, instance.key), { ...states.get(key(fleetId, instance.key))!, error: receipt.error.message });
          }
        }
      }
      else if (operation.action === 'update') {
        if (!configuration) throw new Error('Updating requires a validated fleet configuration');
        const activated = selected.filter(instance => wanted.has(key(fleetId, instance.key)));
        await stopSelected(operation, selected);
        for (const instance of selected) {
          signal.throwIfAborted();
          if (operation.errors.some(error => error.instanceKey === instance.key)) continue;
          const updated = await services.execution.update(configuration, instance, operation.releaseDirectory!, signal);
          if (!updated.ok) {
            operation.errors.push({ instanceKey: instance.key, ...updated.error });
            states.set(key(fleetId, instance.key), { instance, phase: 'failed', error: updated.error.message, sessionId: states.get(key(fleetId, instance.key))?.sessionId ?? null, startedAt: null });
          }
        }
        connect(configuration);
        if (connectionErrors.has(configuration.directory)) throw new Error(connectionErrors.get(configuration.directory)!);
        for (const instance of activated) {
          if (!wanted.has(key(fleetId, instance.key)) || operation.errors.some(error => error.instanceKey === instance.key)) continue;
          const resumed = await services.execution.start(configuration, instance, AbortSignal.any([signal, lifetime.signal]), 'operator');
          if (!resumed.ok) {
            operation.errors.push({ instanceKey: instance.key, ...resumed.error });
            states.set(key(fleetId, instance.key), { instance, phase: 'failed', error: resumed.error.message, sessionId: states.get(key(fleetId, instance.key))?.sessionId ?? null, startedAt: null });
          }
          else if (signal.aborted || !wanted.has(key(fleetId, instance.key))) await discardRuntime(fleetId, instance, resumed.value);
          else launched(fleetId, configuration, instance, resumed.value);
        }
      }
      else {
        if (!configuration) { operation.errors.push({ instanceKey: null, code: 'invalid', message: 'Starting requires a validated fleet configuration' }); return; }
        if (operation.action === 'start' && !selected.length) return;
        await stopSelected(operation, selected.filter(instance => recovering.has(key(fleetId, instance.key))));
        const valid = services.execution.validate(configuration);
        if (!valid.ok) throw new Error(valid.error.message);
        if (operation.action === 'reset') {
          await stopSelected(operation, selected.filter(instance => !operation.errors.some(error => error.instanceKey === instance.key)));
          for (const instance of selected) {
            if (operation.errors.some(error => error.instanceKey === instance.key)) continue;
            const reset = await services.execution.reset(configuration, instance, operation.operationId, signal);
            if (!reset.ok) {
              operation.errors.push({ instanceKey: instance.key, ...reset.error });
              states.set(key(fleetId, instance.key), { instance, phase: 'failed', sessionId: null, startedAt: null, error: reset.error.message });
            }
          }
        }
        for (const instance of selected) if (!running.has(key(fleetId, instance.key)) && !operation.errors.some(error => error.instanceKey === instance.key)) states.set(key(fleetId, instance.key), { instance, phase: 'starting', error: null,
          sessionId: operation.action === 'enroll' ? states.get(key(fleetId, instance.key))?.sessionId ?? null : null, startedAt: null });
        const prepared = await services.execution.prepare(configuration, services.controller, operation.action === 'enroll' ? 'enroll' : 'resume', signal, approval => {
          operation.status = 'awaiting-approval'; operation.approval = approval; saveOperation(operation);
          for (const instance of selected) if (!running.has(key(fleetId, instance.key)) && !operation.errors.some(error => error.instanceKey === instance.key)) states.set(key(fleetId, instance.key), { ...states.get(key(fleetId, instance.key))!, phase: 'awaiting-approval' });
        });
        if (!prepared.ok) { operation.errors.push({ instanceKey: null, ...prepared.error }); return; }
        signal.throwIfAborted();
        connect(configuration);
        if (connectionErrors.has(configuration.directory)) { operation.errors.push({ instanceKey: null, code: 'unavailable', message: connectionErrors.get(configuration.directory)! }); return; }
        operation.errors.push(...prepared.value.failed);
        operation.status = 'running'; operation.approval = null; saveOperation(operation);
        if (operation.action === 'enroll') {
          for (const instance of selected) {
            const error = operation.errors.find(error => error.instanceKey === instance.key);
            states.set(key(fleetId, instance.key), { instance, phase: error ? 'failed' : 'stopped',
              sessionId: states.get(key(fleetId, instance.key))?.sessionId ?? null, startedAt: null, error: error?.message ?? null });
          }
          return;
        }
        const eligible = selected.filter(instance => !operation.errors.some(error => error.instanceKey === instance.key));
        const intentSaved = changeIntent(fleetId, eligible.map(instance => instance.key), true);
        if (!intentSaved.ok) { operation.errors.push({ instanceKey: null, ...intentSaved.error }); return; }
        for (const instance of selected) {
          signal.throwIfAborted();
          const identity = key(fleetId, instance.key);
          if (operation.errors.some(error => error.instanceKey === instance.key)) continue;
          const current = running.get(identity);
          if (current) {
            const resumed = await current.resume();
            if (!resumed.ok) operation.errors.push({ instanceKey: instance.key, ...resumed.error });
            continue;
          }
          const result = await services.execution.start(configuration, instance, AbortSignal.any([signal, lifetime.signal]), 'operator');
          if (signal.aborted || !wanted.has(identity)) { if (result.ok) await discardRuntime(fleetId, instance, result.value); signal.throwIfAborted(); continue; }
          if (!result.ok) { operation.errors.push({ instanceKey: instance.key, ...result.error }); states.set(identity, { instance, phase: 'failed', error: result.error.message, sessionId: null, startedAt: null }); continue; }
          launched(fleetId, configuration, instance, result.value);
        }
      }
    } catch (error) { operation.errors.push({ instanceKey: null, code: 'unavailable', message: error instanceof Error ? error.message : 'Operation failed' }); }
    finally {
      if (signal.aborted && operation.action !== 'stop') for (const instance of selected) await stopInstance(fleetId, instance);
      for (const instance of selected) {
        const identity = key(fleetId, instance.key), state = states.get(identity);
        if (state && ['starting', 'awaiting-approval'].includes(state.phase)) states.set(identity, { ...state, phase: 'failed', error: operation.errors[0]?.message ?? 'Operation did not complete' });
      }
      if (!operation.errors.length && operation.action === 'start') {
        const completed = services.registry.completeSetup(operation.operationId);
        if (!completed.ok) operation.errors.push({ instanceKey: null, ...completed.error });
      }
      operation.status = operation.errors.length ? 'failed' : 'succeeded'; operation.completedAt = services.now(); operation.approval = null; saveOperation(operation);
      if (active.get(fleetId)?.stop.signal === signal) active.delete(fleetId);
    }
  }
  async function operate(input: OperationInput, receiptPending = false): Promise<Result<Operation>> {
    if ((input.action === 'update') !== (input.releaseDirectory !== undefined)) return failure('invalid', 'Only an explicit software update supplies its installed release directory');
    const existing = operations.find(operation => operation.operationId === input.operationId);
    if (existing) {
      const previous = { operationId: existing.operationId, target: existing.target, action: existing.action, expectedRevision: existing.expectedRevision, releaseDirectory: existing.releaseDirectory };
      return previous.action === input.action && previous.expectedRevision === input.expectedRevision && previous.target.kind === input.target.kind
        && previous.target.fleetId === input.target.fleetId && previous.target.instanceKey === input.target.instanceKey && previous.releaseDirectory === input.releaseDirectory
        ? success(structuredClone(existing)) : failure('conflict', 'Operation ID was used for a different request');
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
    if (input.action === 'enroll' && (target.kind !== 'fleet' || executing(target.fleetId))) return failure('conflict', 'Enrollment without startup requires a stopped whole fleet');
    if (mutations.has(target.fleetId)) return failure('conflict', 'A roster change is in progress');
    const record = records.find(item => item.fleetId === target.fleetId);
    if (!record) return failure('missing', 'Fleet is not registered');
    if (record.revision !== input.expectedRevision) return failure('stale_revision', 'Refresh the fleet before starting this operation');
    let configuration: Configuration | null;
    if (input.action === 'stop') {
      const known = deployed.get(target.fleetId), loaded = known ? success(known) : services.registry.load(record.directory);
      configuration = loaded.ok ? loaded.value : null;
    } else {
      const current = inspect(target.fleetId);
      if (!current.ok) return current;
      configuration = current.value.configuration;
    }
    const catalog = new Map((configuration?.roster.instances ?? []).map(instance => [instance.key, instance]));
    if (input.action === 'stop') for (const [identity, state] of states) if (identity.startsWith(target.fleetId + ':')) catalog.set(state.instance.key, state.instance);
    const enabled = [...wanted.values()].filter(item => item.fleetId === target.fleetId).map(item => item.instanceKey);
    const selection = target.kind === 'fleet' && input.action === 'start'
      ? resuming.select(target.fleetId, [...catalog.values()], enabled) : success([...catalog.values()].filter(instance => target.kind !== 'agent' || instance.key === target.instanceKey));
    if (!selection.ok) return selection;
    const selected = selection.value;
    if (target.kind === 'agent' && !selected.length && !wanted.has(key(target.fleetId, target.instanceKey!))) return failure('missing', 'Instance not found');
    if (input.action === 'start' && catalog.size === 0) return failure('invalid', 'Add an instance before starting this fleet');
    if (input.action !== 'stop' && selected.some(instance => {
      const identity = key(target.fleetId!, instance.key), runtime = running.get(identity);
      return runtime && (runtime.signal.aborted || states.get(identity)?.phase === 'failed');
    })) {
      return failure('conflict', 'Runtime failure cleanup is still in progress; retry after it finishes');
    }
    const predecessor = active.get(target.fleetId);
    if (predecessor && input.action !== 'stop') return failure('conflict', 'Another operation is active for this fleet');
    const operation: Operation = { ...input, ...(receiptPending ? { receiptPending: true as const } : {}), status: 'accepted', createdAt: services.now(), completedAt: null, approval: null, errors: [] };
    operations = [...operations.filter(item => item.completedAt === null || item.receiptPending),
      ...operations.filter(item => item.completedAt !== null && !item.receiptPending).slice(-399), operation];
    const stored = services.registry.saveOperations(operations);
    if (!stored.ok) { operations = operations.filter(item => item !== operation); return stored; }
    if (input.action === 'stop' || input.action === 'reset') {
      const checkpoint = input.action === 'stop' ? resuming.stop(target.fleetId, enabled, target.instanceKey) : success(undefined);
      if (!checkpoint.ok) {
        operation.status = 'failed'; operation.completedAt = services.now(); operation.errors.push({ instanceKey: null, ...checkpoint.error }); saveOperation(operation);
        return checkpoint;
      }
      const desiredKeys = [...wanted.values()].filter(item => item.fleetId === target.fleetId && (target.kind !== 'agent' || item.instanceKey === target.instanceKey)).map(item => item.instanceKey);
      const intentSaved = changeIntent(target.fleetId, [...new Set([...selected.map(instance => instance.key), ...desiredKeys])], false);
      if (!intentSaved.ok) {
        operation.status = 'failed'; operation.completedAt = services.now(); operation.errors.push({ instanceKey: null, ...intentSaved.error }); saveOperation(operation);
        return intentSaved;
      }
    }
    if (input.action !== 'stop' && configuration && configuration.digest !== record.digest) {
      const valid = services.execution.validate(configuration);
      const applied = valid.ok ? persist(records.map(record => record.fleetId === target.fleetId ? { ...record,
        digest: configuration.digest, revision: record.revision + 1 } : record)) : valid;
      if (!applied.ok) {
        operation.status = 'failed'; operation.completedAt = services.now(); operation.errors.push({ instanceKey: null, ...applied.error }); saveOperation(operation);
        return applied;
      }
    }
    const stop = new AbortController(); predecessor?.stop.abort(new Error('Start cancelled by explicit stop'));
    for (const instance of selected) restorationOwned.delete(key(target.fleetId, instance.key));
    if (configuration) deployed.set(target.fleetId, configuration);
    const done = Promise.resolve().then(async () => { await predecessor?.done; await execute(operation, configuration, selected, stop.signal); }).catch(async error => {
      operation.status = 'failed'; operation.completedAt = services.now(); operation.approval = null;
      operation.errors.push({ instanceKey: null, code: 'unavailable', message: error instanceof Error ? error.message : 'Operation persistence failed' });
      for (const instance of selected) {
        try { await stopInstance(target.fleetId!, instance); } catch { lifetime.abort(new Error('Runtime cleanup failed')); }
      }
    }).finally(() => { if (active.get(target.fleetId!)?.stop === stop) active.delete(target.fleetId!); });
    active.set(target.fleetId, { stop, done });
    return success(structuredClone(operation));
  }
  async function close(): Promise<void> {
    stopping = true;
    lifetime.abort(new Error('Controller stopping'));
    await restoration;
    await Promise.all(mutations.values());
    for (const operation of active.values()) operation.stop.abort(new Error('Controller stopping'));
    await Promise.all([...active.values()].map(operation => operation.done));
    await Promise.all([...recovering.values()].map(recovery => recovery.done));
    for (const record of records) {
      const configuration = services.registry.load(record.directory);
      if (configuration.ok) for (const instance of configuration.value.roster.instances) await stopInstance(record.fleetId, instance);
    }
    for (const process of running.values()) await process.close();
    running.clear();
    await services.execution.close();
  }
  return success({ status: () => ({ controller: services.controller, startedAt, stopping }), ready: () => restoration, list, view, attachment, contexts, test, add, setup, rename, remove, editInstance, operate, close,
    async delivery(fleetId: string, input: { expectedRevision: number; enabled: boolean }) {
      const current = inspect(fleetId); if (!current.ok) return current;
      if (stopping) return failure('unavailable', 'Controller is stopping');
      return services.execution.delivery(current.value.configuration, input);
    },
    async message(fleetId: string, input: { messageId: string; body: string }) {
      const current = inspect(fleetId); if (!current.ok) return current;
      if (stopping) return failure('unavailable', 'Controller is stopping');
      return services.execution.message(current.value.configuration, input);
    },
    operation(id: string): Result<Operation> { const operation = operations.find(item => item.operationId === id); return operation ? success(structuredClone(operation)) : failure('missing', 'Operation not found'); } });
}
export type FleetController = Extract<ReturnType<typeof createController>, { ok: true }>['value'];
