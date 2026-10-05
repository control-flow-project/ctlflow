import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Configuration, FleetState, Operation, OperationInput, Registration, SetupInput, SetupResult } from './model.js';
import type { Registry } from './port.js';

type SetupPorts = {
  registry: Registry;
  signal: AbortSignal;
  id(): string;
  stopping(): boolean;
  registered(directory: string): Registration | undefined;
  restoring(fleetId: string): Promise<void> | undefined;
  inspect(configuration: Configuration, signal: AbortSignal): Promise<Result<void>>;
  add(directory: string): Result<FleetState>;
  view(fleetId: string): Result<FleetState>;
  test(fleetId: string): Promise<Result<void>>;
  operations(): Operation[];
  operate(input: OperationInput): Promise<Result<Operation>>;
};

export function createSetup(ports: SetupPorts) {
  const pending = new Map<string, Promise<Result<SetupResult>>>();
  async function existing(fleet: FleetState): Promise<Result<SetupResult>> {
    const active = fleet.instances.some(instance => instance.desiredActive);
    const ready = fleet.connection.connected && fleet.instances.every(instance => !instance.desiredActive
      || !!instance.sessionId && ['running', 'sleeping'].includes(instance.phase));
    if (active && ready) { const tested = await ports.test(fleet.fleetId); if (!tested.ok) return tested; }
    return success({ fleet, operation: null, status: active ? ready ? 'ready' : 'starting' : 'stopped' });
  }
  return function setup(input: SetupInput): Promise<Result<SetupResult>> {
    const identity = JSON.stringify([input.workspace, input.configuration ?? null, input.descriptor.server, input.descriptor.ownerMatrixId]);
    const previous = pending.get(identity); if (previous) return previous;
    const running = (async (): Promise<Result<SetupResult>> => {
      if (ports.stopping()) return failure('unavailable', 'Controller is stopping');
      const prepared = ports.registry.setup(input); if (!prepared.ok) return prepared;
      const { configuration, operationId, completed } = prepared.value;
      const inspected = await ports.inspect(configuration, ports.signal); if (!inspected.ok) return inspected;
      const registered = ports.registered(configuration.directory);
      if (completed && !registered) return failure('conflict', 'Completed setup was unregistered; an archived identity cannot be recreated implicitly');
      if (registered) await ports.restoring(registered.fleetId);
      if (ports.stopping()) return failure('unavailable', 'Controller is stopping');
      const fleet = registered ? ports.view(registered.fleetId) : ports.add(configuration.directory);
      if (!fleet.ok) return fleet;
      if (completed) return existing(fleet.value);
      const operation = ports.operations().find(operation => operation.operationId === operationId);
      const deliberatelyStopped = operation && ports.operations().some(candidate => candidate.action === 'stop' && candidate.target.fleetId === fleet.value.fleetId
        && candidate.status === 'succeeded' && candidate.createdAt >= operation.createdAt);
      const restored = registered && operation?.status === 'failed' && fleet.value.instances.length > 0
        && fleet.value.instances.every(instance => instance.desiredActive && !!instance.sessionId && ['running', 'sleeping'].includes(instance.phase));
      if (deliberatelyStopped || restored) {
        const result = await existing(fleet.value); if (!result.ok) return result;
        const marked = ports.registry.completeSetup(operationId); return marked.ok ? result : marked;
      }
      const reusable = operation && operation.status !== 'failed';
      const retryId = operation?.status === 'failed' ? ports.id() : operationId;
      if (retryId !== operationId) { const renewed = ports.registry.retrySetup(operationId, retryId); if (!renewed.ok) return renewed; }
      const accepted = reusable ? success(structuredClone(operation)) : await ports.operate({ operationId: retryId,
        action: 'start', target: { kind: 'fleet', fleetId: fleet.value.fleetId }, expectedRevision: fleet.value.revision });
      if (!accepted.ok) return accepted;
      if (accepted.value.status === 'succeeded') { const tested = await ports.test(fleet.value.fleetId); if (!tested.ok) return tested; }
      return success({ fleet: fleet.value, operation: accepted.value, status: accepted.value.status === 'succeeded' ? 'ready' : 'starting' });
    })().finally(() => { pending.delete(identity); });
    pending.set(identity, running); return running;
  };
}
