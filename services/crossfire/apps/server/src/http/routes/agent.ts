import { operations } from '../../../../../packages/contracts/src/rest/operations.js';
import { changeAgent } from '../../../../../packages/domain/src/agent/change-agent.js';
import { readAgent, listAgents } from '../../../../../packages/domain/src/agent/read-agent.js';
import { deliveryPolicy } from '../../../../../packages/domain/src/agent/delivery-policy.js';
import { readWakePolicy } from '../../../../../packages/domain/src/wake/read-policy.js';
import { changeWakePolicy } from '../../../../../packages/domain/src/wake/change-policy.js';
import { readListenerRuns } from '../../../../../packages/domain/src/listener/read-runs.js';
import { reportListener } from '../../../../../packages/domain/src/listener/report.js';
import { disconnectListeners } from '../../../../../packages/domain/src/listener/disconnect.js';
import { requestWakeNotice } from '../../../../../packages/domain/src/notice/request-notice.js';
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
      agentId: value.record.principal.id, matrixUserId: value.record.principal.matrixUserId, ownerMatrixId: value.record.owner.matrixUserId,
      status: value.record.principal.status, ownerStatus: value.record.owner.status,
      roomGrants: value.grants.map(grant => ({ roomId: grant.roomId, accessMode: grant.accessMode, powerLevel: grant.powerLevel, muted: grant.muted })),
      wakeMode: value.wake.mode, senderMatrixIds: value.wake.senders,
    }))),
    bind(operations.listenerRuns, (context, params, query) => paged(readListenerRuns(context.services, actor(context), params.agentId, query), view.listenerRun)),
    bind(operations.reportListener, (context, params, _query, input) => reply(reportListener(context.services, actor(context), params.agentId, params.runId, input, context.manifest.release))),
    bind(operations.disconnectListeners, (context, params, _query, input) => reply(disconnectListeners(context.services, actor(context), params.agentId, input, context.requestId))),
    bind(operations.wakeNotice, async (context, params, _query, input) => reply(await requestWakeNotice(context.services, actor(context), params.agentId, input.roomId, params.eventId))),
  ];
}
