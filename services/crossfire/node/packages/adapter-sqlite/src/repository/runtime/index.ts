import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type { RuntimeRepository, Incident } from '@ctlflow/crossfire-domain/runtime/types';
import type { DecisionView } from '@ctlflow/crossfire-domain/runtime/values';
import { success } from '@ctlflow/crossfire-kernel/result';
import { nativeSummaries } from './summaries.js';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';

export function createRuntimeRepository(database: Database.Database): RuntimeRepository {
  function decision(row: Tables['runtime_decision']): DecisionView {
    const questions = executeSelect(database, schema, (query, params) => query.from('runtime_decision_question').where(row => row.decision_id === params.id).orderBy(row => row.position), { id: row.id });
    const options = executeSelect(database, schema, (query, params) => query.from('runtime_decision_option').where(row => row.decision_id === params.id).orderBy(row => row.position), { id: row.id });
    return { id: row.id, agentId: row.agent_id, runId: row.run_id, runtime: row.runtime, sessionId: row.session_id,
      requestId: row.request_id, turnId: row.turn_id, itemId: row.item_id, kind: row.kind, action: row.action,
      review: row.review_text, blocking: row.blocking === 1, expiresAt: row.expires_at, createdAt: row.created_at, status: row.status,
      questions: questions.map(question => ({ id: question.question_id, title: question.title, prompt: question.prompt,
        secret: question.secret === 1, allowText: question.allow_text === 1, options: options.filter(option => option.question_id === question.question_id)
          .map(option => ({ id: option.option_id, label: option.label, description: option.description })) })) };
  }
  function incident(row: Tables['runtime_incident']): Incident {
    return { id: row.id, ownerId: row.owner_id, agentId: row.agent_id, fleetId: row.fleet_id, runId: row.run_id, sessionId: row.session_id,
      kind: row.kind, message: row.message, createdAt: row.created_at, recoveredAt: row.recovered_at };
  }
  return {
    summaries(agentIds) { return stored(() => success(nativeSummaries(database, agentIds))); },
    decision(id) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('runtime_decision').where(row => row.id === params.id).firstOrDefault(), { id });
      return success(row ? decision(row) : null);
    }); },
    decisions(agentId, page, pageSize, status) { return stored(() => {
      const totalItems = executeSelect(database, schema, (query, params) => query.from('runtime_decision').where(row => row.agent_id === params.agentId && (params.status === null || row.status === params.status)).count(), { agentId, status });
      const rows = executeSelect(database, schema, (query, params) => query.from('runtime_decision').where(row => row.agent_id === params.agentId && (params.status === null || row.status === params.status))
        .orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit)
        .select(row => ({ id: row.id, agentId: row.agent_id, runId: row.run_id, runtime: row.runtime, sessionId: row.session_id,
          requestId: row.request_id, turnId: row.turn_id, itemId: row.item_id, kind: row.kind, action: row.action,
          blocking: row.blocking, expiresAt: row.expires_at, createdAt: row.created_at, status: row.status })), { agentId, status, offset: (page - 1) * pageSize, limit: pageSize });
      return success({ items: rows.map(row => ({ ...row, blocking: row.blocking === 1 })), totalItems });
    }); },
    pendingDecisions() { return stored(() => success(executeSelect(database, schema, query => query.from('runtime_decision')
      .where(row => row.status === 'pending' || row.status === 'answered')
      .select(row => ({ id: row.id, agentId: row.agent_id, runId: row.run_id, runtime: row.runtime, sessionId: row.session_id,
        requestId: row.request_id, turnId: row.turn_id, itemId: row.item_id, kind: row.kind, action: row.action,
        blocking: row.blocking, expiresAt: row.expires_at, createdAt: row.created_at, status: row.status })))
      .map(row => ({ ...row, blocking: row.blocking === 1 })))); },
    insertDecision(value) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('runtime_decision').values({ id: params.id, agent_id: params.agentId, run_id: params.runId,
        runtime: params.runtime, session_id: params.sessionId, request_id: params.requestId, turn_id: params.turnId, item_id: params.itemId,
        kind: params.kind, action: params.action, review_text: params.review, blocking: params.blocking, expires_at: params.expiresAt, created_at: params.createdAt, status: params.status }), { ...value, blocking: value.blocking ? 1 : 0 });
      for (const [position, question] of value.questions.entries()) {
        executeInsert(database, schema, (query, params) => query.insertInto('runtime_decision_question').values({ decision_id: params.id, question_id: params.questionId, position: params.position,
          title: params.title, prompt: params.prompt, secret: params.secret, allow_text: params.allowText }), { id: value.id, questionId: question.id, position, title: question.title, prompt: question.prompt, secret: question.secret ? 1 : 0, allowText: question.allowText ? 1 : 0 });
        for (const [position, option] of question.options.entries()) executeInsert(database, schema, (query, params) => query.insertInto('runtime_decision_option').values({ decision_id: params.id, question_id: params.questionId, option_id: params.optionId, position: params.position, label: params.label, description: params.description }), { id: value.id, questionId: question.id, optionId: option.id, position, label: option.label, description: option.description });
      }
      return success(undefined);
    }); },
    decisionStatus(id, status) { return stored(() => {
      executeUpdate(database, schema, (query, params) => query.update('runtime_decision').set({ status: params.status }).where(row => row.id === params.id), { id, status });
      if (status !== 'answered') executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_decision_answer').where(row => row.decision_id === params.id), { id });
      return success(undefined);
    }); },
    answers(id) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('runtime_decision_answer').where(row => row.decision_id === params.id), { id })
      .map(row => ({ questionId: row.question_id, optionId: row.option_id, text: row.answer_text })))); },
    answer(id, values) { return stored(() => {
      for (const value of values) executeInsert(database, schema, (query, params) => query.insertInto('runtime_decision_answer').values({ decision_id: params.id, question_id: params.questionId, option_id: params.optionId, answer_text: params.text }), { id, ...value });
      executeUpdate(database, schema, (query, params) => query.update('runtime_decision').set({ status: 'answered' }).where(row => row.id === params.id), { id });
      return success(undefined);
    }); },
    observation(agentId) { return stored(() => {
      const latest = executeSelect(database, schema, (query, params) => query.from('listener_run').where(row => row.agent_id === params.agentId).orderByDescending(row => row.started_at).thenByDescending(row => row.id).firstOrDefault(), { agentId });
      if (!latest) return success([]);
      const rows = executeSelect(database, schema, (query, params) => query.from('runtime_observation').where(row => row.run_id === params.runId).orderByDescending(row => row.observed_at), { runId: latest.id });
      const settings = executeSelect(database, schema, (query, params) => query.from('runtime_setting').where(row => row.run_id === params.id).orderBy(row => row.name), { id: latest.id });
      const bySession = new Map<string, typeof settings>();
      for (const setting of settings) {
        const selected = bySession.get(setting.session_id) ?? [];
        selected.push(setting); bySession.set(setting.session_id, selected);
      }
      return success(rows.map(row => ({ runId: row.run_id, sessionId: row.session_id, roomId: row.room_id, runtime: row.runtime, state: row.state, observedAt: row.observed_at,
        historyMode: row.history_mode, maxInputBytes: row.max_input_bytes, errorMessage: row.error_message,
        lastActivityAt: row.last_activity_at, historyAvailable: row.history_available === null ? null : row.history_available === 1,
        settings: (bySession.get(row.session_id) ?? [])
          .map(setting => ({ name: setting.name, configured: setting.configured_value, effective: setting.effective_value })) })));
    }); },
    saveObservation(agentId, value) { return stored(() => {
      const previous = executeSelect(database, schema, (query, params) => query.from('runtime_observation').where(row => row.run_id === params.id && row.session_id === params.sessionId).firstOrDefault(), { id: value.runId, sessionId: value.sessionId });
      const params = { agentId, ...value, historyAvailable: value.historyAvailable === null ? null : value.historyAvailable ? 1 : 0 };
      if (previous) executeUpdate(database, schema, (query, params) => query.update('runtime_observation').set({ session_id: params.sessionId, room_id: params.roomId, runtime: params.runtime, state: params.state,
        observed_at: params.observedAt, last_activity_at: params.lastActivityAt, history_available: params.historyAvailable,
        history_mode: params.historyMode, max_input_bytes: params.maxInputBytes, error_message: params.errorMessage }).where(row => row.run_id === params.runId && row.session_id === params.sessionId), params);
      else executeInsert(database, schema, (query, params) => query.insertInto('runtime_observation').values({ run_id: params.runId, agent_id: params.agentId, session_id: params.sessionId, room_id: params.roomId, runtime: params.runtime, state: params.state,
        observed_at: params.observedAt, last_activity_at: params.lastActivityAt, history_available: params.historyAvailable,
        history_mode: params.historyMode, max_input_bytes: params.maxInputBytes, error_message: params.errorMessage }), params);
      executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_setting').where(row => row.run_id === params.id && row.session_id === params.sessionId), { id: value.runId, sessionId: value.sessionId });
      for (const setting of value.settings) executeInsert(database, schema, (query, params) => query.insertInto('runtime_setting').values({ run_id: params.id, session_id: params.sessionId, name: params.name, configured_value: params.configured, effective_value: params.effective }), { id: value.runId, sessionId: value.sessionId, ...setting });
      return success(undefined);
    }); },
    incident(id) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('runtime_incident').where(row => row.id === params.id).firstOrDefault(), { id });
      return success(row ? incident(row) : null);
    }); },
    activeIncidents() { return stored(() => success(executeSelect(database, schema, query => query.from('runtime_incident').where(row => row.recovered_at === null)).map(incident))); },
    insertIncident(value) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('runtime_incident').values({ id: params.id, owner_id: params.ownerId, agent_id: params.agentId, fleet_id: params.fleetId, run_id: params.runId, session_id: params.sessionId, kind: params.kind, message: params.message, created_at: params.createdAt, recovered_at: params.recoveredAt }), value);
      return success(undefined);
    }); },
    recoverIncident(id, now) { return stored(() => { executeUpdate(database, schema, (query, params) => query.update('runtime_incident').set({ recovered_at: params.now }).where(row => row.id === params.id), { id, now }); return success(undefined); }); },
    notifications(now) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('incident_notification').where(row => row.event_id === null && row.next_attempt_at <= params.now).orderBy(row => row.next_attempt_at).thenBy(row => row.phase).take(100), { now })
      .map(row => ({ incidentId: row.incident_id, phase: row.phase, body: row.body, nextAttemptAt: row.next_attempt_at, eventId: row.event_id })))); },
    notification(incidentId, phase) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('incident_notification').where(row => row.incident_id === params.incidentId && row.phase === params.phase).firstOrDefault(), { incidentId, phase });
      return success(row ? { incidentId: row.incident_id, phase: row.phase, body: row.body, nextAttemptAt: row.next_attempt_at, eventId: row.event_id } : null);
    }); },
    insertNotification(value) { return stored(() => { executeInsert(database, schema, (query, params) => query.insertInto('incident_notification').values({ incident_id: params.incidentId, phase: params.phase, body: params.body, next_attempt_at: params.nextAttemptAt, event_id: params.eventId }), value); return success(undefined); }); },
    saveNotification(value) { return stored(() => { executeUpdate(database, schema, (query, params) => query.update('incident_notification').set({ next_attempt_at: params.nextAttemptAt, event_id: params.eventId }).where(row => row.incident_id === params.incidentId && row.phase === params.phase), value); return success(undefined); }); },
    conversation(ownerId) { return stored(() => { const row = executeSelect(database, schema, (query, params) => query.from('management_conversation').where(row => row.owner_id === params.id).firstOrDefault(), { id: ownerId }); return success(row ? { ownerId: row.owner_id, roomId: row.room_id, createdAt: row.created_at } : null); }); },
    conversationByRoom(roomId) { return stored(() => { const row = executeSelect(database, schema, (query, params) => query.from('management_conversation').where(row => row.room_id === params.id).firstOrDefault(), { id: roomId }); return success(row ? { ownerId: row.owner_id, roomId: row.room_id, createdAt: row.created_at } : null); }); },
    insertConversation(value) { return stored(() => { executeInsert(database, schema, (query, params) => query.insertInto('management_conversation').values({ owner_id: params.ownerId, room_id: params.roomId, created_at: params.createdAt }), value); return success(undefined); }); },
    watchedRuns() { return stored(() => success(executeSelect(database, schema, query => query.from('listener_run')
      .join(query.from('listener_run').groupBy(row => row.agent_id).select(group => ({ agentId: group.key, startedAt: group.max(row => row.started_at) })),
        row => row.agent_id, latest => latest.agentId, (run, latest) => ({ run, latest }))
      .where(row => row.run.started_at === row.latest.startedAt)
      .select(row => ({ id: row.run.id, agentId: row.run.agent_id, startedAt: row.run.started_at, lastSeenAt: row.run.last_seen_at, stoppedAt: row.run.stopped_at, disconnectRequestedAt: row.run.disconnect_requested_at }))))); },
    watchedFleets() { return stored(() => success(executeSelect(database, schema, query => query.from('fleet_connection')
      .join(query.from('fleet'), connection => connection.fleet_id, fleet => fleet.id, (connection, fleet) => ({ connection, fleet }))
      .select(row => ({ id: row.fleet.id, ownerId: row.fleet.owner_id, label: row.fleet.label, connectionId: row.connection.connection_id, expiresAt: row.connection.expires_at, closedAt: row.connection.closed_at }))))); },
  };
}
