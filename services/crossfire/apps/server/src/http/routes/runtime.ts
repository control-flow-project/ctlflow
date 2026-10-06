import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { createDecision, listDecisions, readDecision, answerDecision, pollDecision, receiptDecision } from '@ctlflow/crossfire-domain/runtime/decisions';
import { readRuntime, reportRuntime } from '@ctlflow/crossfire-domain/runtime/observations';
import { reportFleetFailure } from '@ctlflow/crossfire-domain/runtime/fleet-failure';
import { bind, reply, paged, actor, fleetActor } from '../bind.js';

export function runtimeRoutes() {
  return [
    bind(operations.runtimeObservations, (context, params) => reply(readRuntime(context.services, actor(context), params.agentId))),
    bind(operations.reportRuntime, (context, params, _query, input) => reply(reportRuntime(context.services, actor(context), params.agentId, params.runId, input))),
    bind(operations.runtimeDecisions, (context, params, query) => paged(listDecisions(context.services, actor(context), params.agentId, query))),
    bind(operations.createRuntimeDecision, (context, params, _query, input) => reply(createDecision(context.services, actor(context), params.agentId, input))),
    bind(operations.runtimeDecision, (context, params) => reply(readDecision(context.services, actor(context), params.agentId, params.decisionId))),
    bind(operations.answerRuntimeDecision, (context, params, _query, input) => reply(answerDecision(context.services, actor(context), params.agentId, params.decisionId, input, context.requestId))),
    bind(operations.pollRuntimeDecision, (context, params) => reply(pollDecision(context.services, actor(context), params.agentId, params.decisionId))),
    bind(operations.receiptRuntimeDecision, (context, params, _query, input) => reply(receiptDecision(context.services, actor(context), params.agentId, params.decisionId, input.status))),
    bind(operations.reportFleetFailure, (context, params, _query, input) => reply(reportFleetFailure(context.services, fleetActor(context), params.fleetId, input))),
  ];
}
