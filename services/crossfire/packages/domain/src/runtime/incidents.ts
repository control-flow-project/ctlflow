import type { Services } from '../port/services.js';
import type { Incident } from './types.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { HEARTBEAT_EXPIRY_MS } from '../listener/report.js';
import { agentDisplayName } from '../identity/display-name.js';

export function openIncident(services: Services, input: Omit<Incident, 'id' | 'createdAt' | 'recoveredAt'>, episodeId?: string) {
  const id = episodeId ?? services.identity.id();
  const existing = services.runtime.incident(id);
  if (!existing.ok) return existing;
  if (existing.value) return existing.value.ownerId === input.ownerId && existing.value.agentId === input.agentId
    && existing.value.fleetId === input.fleetId && existing.value.runId === input.runId && existing.value.sessionId === input.sessionId
    && existing.value.kind === input.kind && existing.value.message === input.message ? success(undefined) : failure('conflict', 'Incident identity changed');
  const previous = services.runtime.activeIncidents();
  if (!previous.ok) return previous;
  if (previous.value.some(value => value.agentId === input.agentId && value.fleetId === input.fleetId && value.sessionId === input.sessionId && value.kind === input.kind)) return success(undefined);
  const deployments = input.agentId ? services.directory.deployments([input.agentId]) : success([]);
  if (!deployments.ok) return deployments;
  const fleet = input.fleetId ? services.repositories.fleet.findById(input.fleetId) : success(null);
  if (!fleet.ok) return fleet;
  const controller = deployments.value[0]?.controllerName ?? fleet.value?.controllerName;
  const saved = services.runtime.insertIncident({ ...input, id, createdAt: services.clock.now(), recoveredAt: null });
  return saved.ok ? services.runtime.insertNotification({ incidentId: id, phase: 'initial', body: input.message
    + '\nObserved ' + new Date(services.clock.now()).toISOString() + (controller ? '\nController: ' + controller : '\nDirect connection')
    + '\n' + services.instance.publicOrigin + '/manage/'
    + (input.agentId ? 'agents/' + input.agentId + '/activity' : 'fleets/' + input.fleetId), nextAttemptAt: services.clock.now(), eventId: null }) : saved;
}
export function recoverIncidents(services: Services, agentId: string | null, fleetId: string | null, sessionId: string | null = null, kind?: Incident['kind']) {
  const previous = services.runtime.activeIncidents();
  if (!previous.ok) return previous;
  for (const value of previous.value.filter(value => value.agentId === agentId && value.fleetId === fleetId
    && (kind === undefined || value.kind === kind)
    && (value.kind === 'contact' || value.sessionId === null || value.sessionId === sessionId))) {
    const saved = services.runtime.recoverIncident(value.id, services.clock.now());
    if (!saved.ok) return saved;
    const notice = services.runtime.insertNotification({ incidentId: value.id, phase: 'recovery', body: (value.kind === 'contact' ? 'Contact restored.' : 'Native execution resumed.') + '\n' + value.message,
      nextAttemptAt: services.clock.now(), eventId: null });
    if (!notice.ok) return notice;
  }
  return success(undefined);
}
export async function reconcileRuntime(services: Services, stopped: () => boolean) {
  const watched = services.unitOfWork.run(() => {
    const runs = services.runtime.watchedRuns(), fleets = services.runtime.watchedFleets();
    if (!runs.ok) return runs; if (!fleets.ok) return fleets;
    const newest = new Map<string, (typeof runs.value)[number]>();
    for (const run of runs.value) {
      const previous = newest.get(run.agentId);
      if (!previous || previous.startedAt < run.startedAt || previous.startedAt === run.startedAt && previous.id < run.id) newest.set(run.agentId, run);
    }
    for (const run of newest.values()) {
      if (run.stoppedAt !== null || run.disconnectRequestedAt !== null) continue;
      if (run.lastSeenAt + HEARTBEAT_EXPIRY_MS > services.clock.now()) {
        const restored = recoverIncidents(services, run.agentId, null, null, 'contact');
        if (!restored.ok) return restored;
        continue;
      }
      const agent = services.directory.agent(run.agentId);
      if (!agent.ok) return agent;
      if (!agent.value || agent.value.principal.status !== 'active' || agent.value.owner.status !== 'active') continue;
      const created = openIncident(services, { ownerId: agent.value.agent.ownerId, agentId: run.agentId, fleetId: null, runId: run.id, sessionId: null, kind: 'contact',
        message: agentDisplayName(agent.value.name, agent.value.ownerMember.displayName, agent.value.agent.displayNameOverride) + ': listener contact lost. Execution state is unknown; this is not proof of a crash.' });
      if (!created.ok) return created;
    }
    for (const fleet of fleets.value) {
      if (fleet.closedAt === null && fleet.expiresAt > services.clock.now()) { const restored = recoverIncidents(services, null, fleet.id); if (!restored.ok) return restored; }
      if (fleet.closedAt !== null || fleet.expiresAt > services.clock.now()) continue;
      const created = openIncident(services, { ownerId: fleet.ownerId, agentId: null, fleetId: fleet.id, runId: null, sessionId: null, kind: 'contact',
        message: fleet.label + ': controller contact lost. Bound listeners deactivate; native execution state is unknown.' });
      if (!created.ok) return created;
    }
    return success(undefined);
  });
  if (!watched.ok) return watched;
  const pending = services.runtime.notifications(services.clock.now());
  if (!pending.ok) return pending;
  for (const notice of pending.value) {
    if (stopped()) break;
    if (notice.phase === 'recovery') {
      const initial = services.runtime.notification(notice.incidentId, 'initial');
      if (!initial.ok) return initial;
      if (!initial.value?.eventId) continue;
    }
    const incident = services.runtime.incident(notice.incidentId);
    if (!incident.ok) return incident;
    if (!incident.value) return failure('missing', 'Incident not found');
    const owner = services.repositories.principal.find({ id: incident.value.ownerId });
    if (!owner.ok) return owner;
    if (!owner.value || owner.value.status !== 'active') continue;
    const previous = services.runtime.conversation(owner.value.id);
    if (!previous.ok) return previous;
    if (!previous.value) {
      const named = await services.matrix.setDisplayName(services.instance.serviceMatrixId, 'Crossfire');
      if (!named.ok) continue;
    }
    const conversation = await services.matrix.ownerConversation(owner.value.matrixUserId, services.instance.serviceMatrixId, previous.value?.roomId ?? null, null);
    if (!conversation.ok) {
      const saved = services.unitOfWork.run(() => services.runtime.saveNotification({ ...notice, nextAttemptAt: services.clock.now() + 30000 }));
      if (!saved.ok) return saved;
      continue;
    }
    if (!previous.value) {
      const saved = services.unitOfWork.run(() => services.runtime.insertConversation({ ownerId: owner.value!.id, roomId: conversation.value, createdAt: services.clock.now() }));
      if (!saved.ok) continue;
    }
    const sent = await services.matrix.sendNotice(services.instance.serviceMatrixId, conversation.value, 'incident-' + notice.incidentId + '-' + notice.phase, notice.body, owner.value.matrixUserId);
    const saved = services.unitOfWork.run(() => services.runtime.saveNotification({ ...notice, nextAttemptAt: services.clock.now() + 30000, eventId: sent.ok ? sent.value : null }));
    if (!saved.ok) return saved;
  }
  return success(undefined);
}
