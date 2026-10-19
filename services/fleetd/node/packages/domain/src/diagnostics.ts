import type { NativeDiagnostic } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { FleetState } from './model.js';
import type { Running } from './port.js';

export type DiagnosticScope = { fleetId: string | null; instanceKey: string | null };
export type DiagnosticCheck = { id: string; scope: DiagnosticScope; status: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  observedAt: number | null; message: string; remediation: string | null };
export type DiagnosticReport = { checkedAt: number; scope: DiagnosticScope; checks: DiagnosticCheck[] };
type DiagnosticRuntime = Pick<Running, 'signal' | 'diagnostics'>;
type Sources = { now(): number; stopping(): boolean; fleet(id: string): Result<FleetState>; registered(id: string): boolean;
  running(fleetId: string, instanceKey: string): DiagnosticRuntime | undefined };

function listenerFinding(instance: FleetState['instances'][number], connection: FleetState['connection'], live: boolean): Pick<DiagnosticCheck, 'status' | 'message' | 'remediation'> {
  if (instance.listenerActive) return { status: 'pass', message: 'Listener delivery is active', remediation: null };
  if (!instance.desiredActive) return { status: 'not-applicable', message: 'Agent is not selected for listener delivery', remediation: null };
  if (live && connection.connected && !connection.deliveryEnabled) return { status: 'pass', message: 'Listener delivery is deliberately paused', remediation: null };
  if (live || ['starting', 'waking', 'awaiting-approval'].includes(instance.phase)) return { status: 'unknown',
    message: 'Listener delivery has not been activated', remediation: 'Inspect fleet show and any pending enrollment or startup operation' };
  return { status: 'fail', message: 'Selected agent has no live listener owner', remediation: 'Inspect the agent failure and resume it explicitly if needed' };
}

export function createDiagnostics(sources: Sources) {
  return async (scope: DiagnosticScope, signal: AbortSignal): Promise<Result<DiagnosticReport>> => {
    if (scope.instanceKey !== null && scope.fleetId === null) return failure('invalid', 'An instance requires a fleet');
    if (scope.fleetId !== null && !sources.registered(scope.fleetId)) return failure('missing', 'Fleet is not registered');
    const checkedAt = sources.now(), checks: DiagnosticCheck[] = [];
    const add = (id: string, target: DiagnosticScope, status: DiagnosticCheck['status'], message: string,
      remediation: string | null = null, observedAt: number | null = checkedAt) => checks.push({ id, scope: target, status, observedAt, message, remediation });
    const controller = { fleetId: null, instanceKey: null };
    add('controller.connection', controller, 'pass', 'Authenticated controller API is reachable');
    add('controller.lifecycle', controller, sources.stopping() ? 'fail' : 'pass', sources.stopping() ? 'Controller is stopping' : 'Controller is running',
      sources.stopping() ? 'Start the controller after shutdown completes' : null);
    if (scope.fleetId === null) return success({ checkedAt, scope, checks });
    const fleetScope = { fleetId: scope.fleetId, instanceKey: null }, fleet = sources.fleet(scope.fleetId);
    if (!fleet.ok) {
      add('fleet.configuration', fleetScope, 'fail', 'Registered fleet configuration cannot be loaded', 'Correct the registered directory and fleet configuration');
      add('fleet.connection', fleetScope, 'unknown', 'Fleet connection cannot be evaluated without its configuration', null, null);
      return success({ checkedAt, scope, checks });
    }
    const fleetState = fleet.value;
    const instances = fleetState.instances.filter(item => scope.instanceKey === null || item.instance.key === scope.instanceKey);
    if (scope.instanceKey !== null && !instances.length) return failure('missing', 'Instance not found');
    add('fleet.configuration', fleetScope, 'pass', 'Registered fleet configuration is readable');
    const connected = fleetState.connection.connected;
    add('fleet.connection', fleetScope, connected ? 'pass' : 'fail', connected ? 'Controller reports an active crossfire connection' : 'Controller has no active crossfire connection',
      connected ? null : 'Check crossfire availability, enrollment and controller logs');
    add('fleet.delivery', fleetScope, connected ? 'pass' : 'unknown', connected ? (fleetState.connection.deliveryEnabled ? 'Message delivery is enabled' : 'Message delivery is deliberately paused') : 'Delivery intent has not been confirmed by crossfire',
      null, connected ? checkedAt : null);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    let next = 0;
    async function inspect(): Promise<void> {
      for (let index = next++; index < instances.length; index = next++) {
        const instance = instances[index]!, target = { fleetId: scope.fleetId, instanceKey: instance.instance.key };
        const runtime = sources.running(scope.fleetId!, instance.instance.key);
        add('agent.activation', target, 'pass', instance.desiredActive ? 'Agent is selected for activation' : 'Agent is not selected for activation');
        const listener = listenerFinding(instance, fleetState.connection, !!runtime && !runtime.signal.aborted);
        add('agent.listener', target, listener.status, listener.message, listener.remediation);
        add('agent.history', target, instance.historyAvailable === null ? 'unknown' : instance.historyAvailable ? 'pass' : 'fail',
          instance.historyAvailable === null ? 'No saved-history observation is available' : instance.historyAvailable ? 'Controller previously observed a retained history binding; files were not revalidated' : 'No retained history binding was observed',
          instance.historyAvailable === false ? 'Inspect retained contexts before choosing an explicit fresh-history operation' : null, instance.lastActivityAt);
        let native: NativeDiagnostic | null = null;
        if (runtime && !runtime.signal.aborted && !deadline.aborted) {
          try { native = await runtime.diagnostics(AbortSignal.any([deadline, AbortSignal.timeout(5000)])); } catch {}
        }
        const current = runtime && sources.running(scope.fleetId!, instance.instance.key) === runtime && !runtime.signal.aborted;
        if (!current) native = null;
        const state = native?.state ?? (instance.phase === 'stopped' ? 'stopped' : instance.phase === 'failed' ? 'failed' : 'unknown');
        add('agent.native', target, state === 'failed' || state === 'unavailable' ? 'fail' : state === 'unknown' ? 'unknown' : 'pass', 'Native state: ' + state,
          state === 'failed' ? 'Inspect the native failure and retained history before resuming' : null, native?.observedAt ?? null);
        const provider = native?.provider ?? 'unknown', inactive = state === 'stopped' || state === 'sleeping';
        add('agent.provider', target, provider === 'present' ? 'pass' : provider === 'missing' ? 'fail' : provider === 'not-required' || inactive ? 'not-applicable' : 'unknown',
          provider === 'present' ? 'Native provider metadata is present; no inference or credential refresh was performed' : provider === 'missing' ? 'Native provider metadata is missing' : provider === 'not-required' ? 'Selected native provider does not require an account' : inactive ? 'No native provider was started to inspect this sleeping or stopped agent' : 'Provider metadata could not be observed',
          provider === 'missing' ? 'Sign in using the selected native harness, then explicitly resume the agent' : null, native?.providerObservedAt ?? null);
        add('agent.input', target, native === null ? 'unknown' : native.pendingInput ? 'unknown' : 'pass',
          native === null ? 'Native input state was not observed' : native.pendingInput ? 'A native message is still awaiting delivery confirmation' : 'No native input is awaiting delivery confirmation', null, native?.checkedAt ?? null);
        add('agent.decision', target, native === null ? 'unknown' : 'pass', native === null ? 'Native decision state was not observed' : native.pendingDecision ? 'Agent is waiting for an owner decision' : 'No owner decision is pending',
          native?.pendingDecision ? 'Open the owner DM and answer the pending request' : null, native?.checkedAt ?? null);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, instances.length) }, inspect));
    const compare = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
    checks.sort((left, right) => compare(left.scope.instanceKey ?? '', right.scope.instanceKey ?? '') || compare(left.id, right.id));
    return success({ checkedAt, scope, checks });
  };
}
