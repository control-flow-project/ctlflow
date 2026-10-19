import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { changeAgent } from '@ctlflow/crossfire-domain/agent/change-agent';
import { readAgent, listAgents } from '@ctlflow/crossfire-domain/agent/read-agent';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { readWakePolicy } from '@ctlflow/crossfire-domain/wake/read-policy';
import { changeWakePolicy } from '@ctlflow/crossfire-domain/wake/change-policy';
import { readListenerRuns } from '@ctlflow/crossfire-domain/listener/read-runs';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { requestWakeNotice } from '@ctlflow/crossfire-domain/notice/request-notice';
import { bind, reply, paged, actor } from '../bind.js';
import * as view from '../representation/identity.js';
export function agentRoutes() {
  return [
    bind(operations.agents, (context, _params, query) => paged(listAgents(context.services, actor(context), query), view.agent)),
    bind(operations.agent, (context, params) => reply(readAgent(context.services, actor(context), params.agentId), view.agent)),
    bind(operations.changeAgent, (context, params, _query, input) => {
      const result = changeAgent(context.services, actor(context), params.agentId, input, context.requestId);
      return result.ok ? reply(readAgent(context.services, actor(context), params.agentId), view.agent) : result;
    }),
    bind(operations.wakePolicy, (context, params) => reply(readWakePolicy(context.services, actor(context), params.agentId))),
    bind(operations.changeWakePolicy, (context, params, _query, input) => {
      const result = changeWakePolicy(context.services, actor(context), params.agentId, input, context.requestId);
      return result.ok ? reply(readWakePolicy(context.services, actor(context), params.agentId)) : result;
    }),
    bind(operations.deliveryPolicy, (context, params) => reply(deliveryPolicy(context.services, actor(context), params.agentId), value => ({
      agentId: value.record.principal.id, backendUserId: value.record.principal.backendUserId, ownerBackendUserId: value.record.owner.backendUserId,
      status: value.record.principal.status, ownerStatus: value.record.owner.status, ownerConversation: value.ownerConversation,
      roomGrants: value.grants.map(grant => ({ roomId: grant.roomId, accessMode: grant.accessMode, nativeAccess: grant.nativeAccess, muted: grant.muted })),
      wakeMode: value.wake.mode, senderBackendUserIds: value.wake.senders,
      maxMessageBytes: value.maxMessageBytes,
      fleetIdleTimeoutSeconds: value.fleetIdleTimeoutSeconds,
    }))),
    bind(operations.listenerRuns, (context, params, query) => paged(readListenerRuns(context.services, actor(context), params.agentId, query), view.listenerRun)),
    bind(operations.reportListener, (context, params, _query, input) => reply(reportListener(context.services, actor(context), params.agentId, params.runId, input, context.manifest.release))),
    bind(operations.wakeNotice, async (context, params, _query, input) => reply(await requestWakeNotice(context.services, actor(context), params.agentId, input.roomId, params.eventId))),
  ];
}
