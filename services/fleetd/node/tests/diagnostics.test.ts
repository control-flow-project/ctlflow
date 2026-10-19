import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDiagnostics } from '@ctlflow/fleetd-domain/diagnostics';
import type { FleetState } from '@ctlflow/fleetd-domain/model';
import type { NativeDiagnostic } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { diagnosticQuery, diagnosticReport } from '@ctlflow/fleetd-contracts/diagnostics';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
function fixture() {
  const fleetId = randomUUID(), state: FleetState = { fleetId, fleetKey: 'test', directory: '/private/source', label: 'test', revision: 0,
    controller: { name: 'test' }, resumeInstanceKeys: null, phase: 'running', error: null,
    connection: { connected: false, deliveryEnabled: false, revision: null, error: 'private-secret' },
    instances: ['a-b', 'ab'].map(key => ({ instance: { key, name: key, definition: key, workarea: key }, phase: 'running', sessionId: randomUUID(),
      error: 'private-secret', startedAt: 1, listenerActive: true, desiredActive: true, historyAvailable: true, lastActivityAt: 2 })) };
  const native: NativeDiagnostic = { checkedAt: 5, state: 'working', observedAt: 3, provider: 'missing', providerObservedAt: 4, pendingInput: true, pendingDecision: true };
  let probes = 0;
  const runtime = { signal: new AbortController().signal, diagnostics: async (_signal: AbortSignal) => { probes++; return { ...native }; } };
  const sources = { now: () => 1000, stopping: () => false, registered: (id: string) => id === fleetId,
    fleet: (_id: string): Result<FleetState> => success(state), running: (_fleet: string, _instance: string) => runtime };
  return { sources, fleetId, state, native, probes: () => probes };
}

test('diagnostics collect every independent failure and preserve normal work and owner decisions', async scope => {
  const current = fixture(), diagnose = createDiagnostics(current.sources);
  const report = value(await diagnose({ fleetId: current.fleetId, instanceKey: null }, scope.signal));
  assert(diagnosticReport(report).ok);
  assert.equal(report.checks.filter(check => check.status === 'fail').length, 3, 'One connection plus both provider failures are retained');
  assert.equal(report.checks.find(check => check.id === 'fleet.delivery')?.status, 'unknown');
  assert(report.checks.filter(check => check.id === 'agent.native').every(check => check.message === 'Native state: working' && check.status === 'pass'));
  assert(report.checks.filter(check => check.id === 'agent.input').every(check => check.status === 'unknown'));
  assert(report.checks.filter(check => check.id === 'agent.decision').every(check => check.remediation === 'Open the owner DM and answer the pending request'));
  assert.deepEqual([...new Set(report.checks.map(check => check.scope.instanceKey).filter(Boolean))], ['a-b', 'ab']);
  assert.equal(current.probes(), 2); assert(!JSON.stringify(report).includes('private-secret')); assert(!JSON.stringify(report).includes('/private/source'));
  current.native.state = 'unavailable'; current.native.provider = 'present';
  const unavailable = value(await diagnose({ fleetId: current.fleetId, instanceKey: 'ab' }, scope.signal));
  assert.equal(unavailable.checks.find(check => check.id === 'agent.native')?.status, 'fail');
});

test('invalid configuration returns independent findings without exposing the private failure', async scope => {
  const current = fixture(); current.sources.fleet = () => failure('invalid', 'private-secret');
  const report = value(await createDiagnostics(current.sources)({ fleetId: current.fleetId, instanceKey: null }, scope.signal));
  assert.equal(report.checks.find(check => check.id === 'fleet.configuration')?.status, 'fail');
  assert.equal(report.checks.find(check => check.id === 'fleet.connection')?.status, 'unknown');
  assert.equal(current.probes(), 0); assert(!JSON.stringify(report).includes('private-secret'));
});

test('controller-only, invalid, cancelled and retired-generation inspection never manufactures successful provider evidence', async scope => {
  const current = fixture(), diagnose = createDiagnostics(current.sources);
  value(await diagnose({ fleetId: null, instanceKey: null }, scope.signal)); assert.equal(current.probes(), 0);
  assert.equal((await diagnose({ fleetId: null, instanceKey: 'ab' }, scope.signal)).ok, false);
  assert.equal((await diagnose({ fleetId: randomUUID(), instanceKey: null }, scope.signal)).ok, false);
  assert.equal((await diagnose({ fleetId: current.fleetId, instanceKey: 'absent' }, scope.signal)).ok, false);
  const cancelled = value(await diagnose({ fleetId: current.fleetId, instanceKey: 'ab' }, AbortSignal.abort()));
  assert.equal(current.probes(), 0); assert.equal(cancelled.checks.find(check => check.id === 'agent.provider')?.status, 'unknown');
  const runtime = current.sources.running('', '');
  current.sources.running = () => ({ ...runtime });
  const replaced = value(await diagnose({ fleetId: current.fleetId, instanceKey: 'ab' }, scope.signal));
  assert.equal(replaced.checks.find(check => check.id === 'agent.provider')?.status, 'unknown');
});

test('diagnostic query rejects unknown, duplicated, unscoped and malformed values', () => {
  assert(diagnosticQuery(new URLSearchParams()).ok);
  for (const query of ['fleetId=bad', 'instanceKey=ab', 'extra=1', 'fleetId=&fleetId=', 'instanceKey=ab&instanceKey=ab'])
    assert.equal(diagnosticQuery(new URLSearchParams(query)).ok, false);
});

test('clearing desired activation never masquerades as completed native shutdown', async scope => {
  const current = fixture(), instance = current.state.instances[0]!;
  instance.desiredActive = false; instance.listenerActive = false; instance.phase = 'stopping';
  const diagnose = createDiagnostics({ ...current.sources, running: () => undefined });
  let report = value(await diagnose({ fleetId: current.fleetId, instanceKey: instance.instance.key }, scope.signal));
  assert.equal(report.checks.find(check => check.id === 'agent.native')?.message, 'Native state: unknown');
  assert.equal(report.checks.find(check => check.id === 'agent.provider')?.status, 'unknown');
  instance.phase = 'stopped';
  report = value(await diagnose({ fleetId: current.fleetId, instanceKey: instance.instance.key }, scope.signal));
  assert.equal(report.checks.find(check => check.id === 'agent.native')?.message, 'Native state: stopped');
  assert.equal(report.checks.find(check => check.id === 'agent.provider')?.status, 'not-applicable');
  instance.phase = 'failed';
  report = value(await diagnose({ fleetId: current.fleetId, instanceKey: instance.instance.key }, scope.signal));
  assert.equal(report.checks.find(check => check.id === 'agent.native')?.status, 'fail');
});

test('paused delivery and expected startup do not masquerade as failed listener processes', async scope => {
  const current = fixture(), instance = current.state.instances[0]!;
  current.state.connection.connected = true; current.state.connection.deliveryEnabled = false; instance.listenerActive = false;
  let report = value(await createDiagnostics(current.sources)({ fleetId: current.fleetId, instanceKey: instance.instance.key }, scope.signal));
  assert.equal(report.checks.find(check => check.id === 'agent.listener')?.status, 'pass');
  assert.equal(report.checks.find(check => check.id === 'agent.listener')?.message, 'Listener delivery is deliberately paused');
  const diagnose = createDiagnostics({ ...current.sources, running: () => undefined });
  for (const phase of ['starting', 'awaiting-approval', 'waking'] as const) {
    instance.phase = phase;
    report = value(await diagnose({ fleetId: current.fleetId, instanceKey: instance.instance.key }, scope.signal));
    assert.equal(report.checks.find(check => check.id === 'agent.listener')?.status, 'unknown');
  }
  instance.phase = 'failed';
  report = value(await diagnose({ fleetId: current.fleetId, instanceKey: instance.instance.key }, scope.signal));
  assert.equal(report.checks.find(check => check.id === 'agent.listener')?.status, 'fail');
});
