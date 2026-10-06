import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import type { RetirementSelection, RetirementSnapshot } from '@ctlflow/crossfire-domain/port/listener-read';
import { schema } from '../../schema/tables.js';

export function readRetirement(database: Database.Database, selection: RetirementSelection, now: number): RetirementSnapshot {
  const selectedFleetIds = selection.fleetIds ?? [];
  const agentIds = selection.agentIds ?? (selectedFleetIds.length ? executeSelect(database, schema, (query, params) => query.from('fleet_instance')
    .join(query.from('fleet'), instance => instance.owner_id, fleet => fleet.owner_id, (instance, fleet) => ({ instance, fleet }))
    .where(row => params.fleetIds.includes(row.fleet.id) && row.instance.retired_at === null && row.fleet.archived_at === null
      && row.instance.fleet_key === row.fleet.fleet_key).select(row => ({ agentId: row.instance.agent_id })),
  { fleetIds: selectedFleetIds }).map(row => row.agentId) : []);
  if (!agentIds.length && !selectedFleetIds.length) return { agents: [], pendingFleetIds: [] };
  const members = executeSelect(database, schema, (query, params) => query.from('fleet_instance')
    .join(query.from('fleet'), instance => instance.owner_id, fleet => fleet.owner_id, (instance, fleet) => ({ instance, fleet }))
    .join(query.from('principal'), row => row.instance.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
    .where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key
      && params.agentIds.includes(row.instance.agent_id))
    .select(row => ({ agentId: row.instance.agent_id, fleetId: row.fleet.id, ownerActive: row.owner.status === 'active' })),
  { agentIds });
  const ids = members.map(member => member.agentId), fleetIds = [...new Set([...selectedFleetIds, ...members.map(member => member.fleetId)])];
  const pendingOperations = executeSelect(database, schema, (query, params) => query.from('fleet_runtime_operation')
    .where(row => params.fleetIds.includes(row.fleet_id) && (row.status === 'pending' || row.status === 'running'))
    .select(row => ({ fleetId: row.fleet_id })).distinct(), { fleetIds });
  const pendingFleetIds = new Set(pendingOperations.map(operation => operation.fleetId));
  if (!ids.length) return { agents: [], pendingFleetIds: [...pendingFleetIds] };
  const latestRuns = executeSelect(database, schema, (query, params, helpers) => query.from('listener_run')
    .where(row => params.agentIds.includes(row.agent_id))
    .select(row => ({ agentId: row.agent_id, id: row.id, stoppedAt: row.stopped_at,
      fleetId: row.controller_fleet_id, connectionId: row.controller_connection_id, credentialId: row.controller_credential_id,
      position: helpers.window(row).partitionBy(item => item.agent_id).orderByDescending(item => item.started_at)
        .thenByDescending(item => item.id).rowNumber() })).where(row => row.position === 1), { agentIds: ids });
  const runByAgent = new Map(latestRuns.map(run => [run.agentId, { id: run.id, stoppedAt: run.stoppedAt,
    controller: run.fleetId !== null && run.connectionId !== null && run.credentialId !== null
      ? { fleetId: run.fleetId, connectionId: run.connectionId, credentialId: run.credentialId } : null }]));
  const proofs = executeSelect(database, schema, (query, params, helpers) => query.from('fleet_native_stop')
    .where(row => params.agentIds.includes(row.agent_id))
    .select(row => ({ agentId: row.agent_id, receiptId: row.receipt_id, sequence: row.sequence, fleetId: row.fleet_id, runId: row.run_id,
      connectionId: row.connection_id, credentialId: row.credential_id, nativeStoppedAt: row.native_stopped_at, invalidatedAt: row.invalidated_at,
      position: helpers.window(row).partitionBy(item => item.agent_id).orderByDescending(item => item.sequence).rowNumber() }))
    .where(row => row.position === 1), { agentIds: ids });
  const proofByAgent = new Map(proofs.map(({ position, ...proof }) => [proof.agentId, proof]));
  const observed = executeSelect(database, schema, (query, params) => query.from('runtime_observation')
    .where(row => params.agentIds.includes(row.agent_id)).select(row => ({ agentId: row.agent_id })).distinct(), { agentIds: ids });
  const observedAgents = new Set(observed.map(row => row.agentId));
  const active = executeSelect(database, schema, (query, params) => query.from('runtime_observation')
    .where(row => params.runIds.includes(row.run_id) && row.state !== 'sleeping' && row.state !== 'unavailable')
    .groupBy(row => row.agent_id).select(group => ({ agentId: group.key, observedAt: group.max(row => row.observed_at) })),
  { runIds: latestRuns.map(run => run.id) });
  const activeByAgent = new Map(active.map(row => [row.agentId, row.observedAt]));
  const decisions = executeSelect(database, schema, (query, params) => query.from('runtime_decision')
    .where(row => params.agentIds.includes(row.agent_id) && (row.status === 'pending' || row.status === 'answered'))
    .select(row => ({ agentId: row.agent_id })).distinct(), { agentIds: ids });
  const decisionAgents = new Set(decisions.map(row => row.agentId));
  const wake = executeSelect(database, schema, (query, params) => query.from('wake_delivery')
    .where(row => params.agentIds.includes(row.agent_id) && row.status === 'pending')
    .select(row => ({ agentId: row.agent_id })).distinct(), { agentIds: ids });
  const wakeAgents = new Set(wake.map(row => row.agentId));
  const broadcasts = executeSelect(database, schema, (query, params) => query.from('fleet_message_delivery')
    .join(query.from('fleet_message'), delivery => delivery.message_id, message => message.id, (delivery, message) => ({ delivery, message }))
    .where(row => params.agentIds.includes(row.delivery.agent_id) && row.delivery.status === 'pending' && row.message.expires_at > params.now)
    .select(row => ({ agentId: row.delivery.agent_id })).distinct(), { agentIds: ids, now });
  const broadcastAgents = new Set(broadcasts.map(row => row.agentId));
  const controllers = executeSelect(database, schema, (query, params) => query.from('fleet_connection')
    .where(row => params.fleetIds.includes(row.fleet_id))
    .select(row => ({ fleetId: row.fleet_id, connectionId: row.connection_id, credentialId: row.credential_id,
      lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, closedAt: row.closed_at })), { fleetIds });
  const credentials = executeSelect(database, schema, (query, params) => query.from('fleet_credential')
    .where(row => params.ids.includes(row.id)).select(row => ({ id: row.id, fleetId: row.fleet_id, revokedAt: row.revoked_at })),
  { ids: controllers.map(controller => controller.credentialId) });
  const credentialById = new Map(credentials.map(credential => [credential.id, credential]));
  const controllerByFleet = new Map(controllers.map(controller => [controller.fleetId,
    { ...controller, credential: credentialById.get(controller.credentialId) ?? null }]));
  return { pendingFleetIds: [...pendingFleetIds], agents: members.map(member => ({ ...member,
    pendingOperation: pendingFleetIds.has(member.fleetId), pendingDecision: decisionAgents.has(member.agentId),
    pendingWake: wakeAgents.has(member.agentId), pendingBroadcast: broadcastAgents.has(member.agentId),
    hasObservedRuntime: observedAgents.has(member.agentId), latestRun: runByAgent.get(member.agentId) ?? null,
    latestActiveObservationAt: activeByAgent.get(member.agentId) ?? null, nativeStop: proofByAgent.get(member.agentId) ?? null,
    controller: controllerByFleet.get(member.fleetId) ?? null })) };
}
