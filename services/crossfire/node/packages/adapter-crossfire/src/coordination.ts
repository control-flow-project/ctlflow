import { createClient, type ClientOptions } from '@ctlflow/crossfire-client/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { Coordination } from '@ctlflow/crossfire-agent-core/coordination';
import { success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Response } from '@ctlflow/crossfire-contracts/rest/envelope';

async function data<Value>(response: Promise<Result<Response<Value>>>): Promise<Result<Value>> {
  const result = await response;
  return result.ok ? success(result.value.data) : result;
}
export function createCoordination(options: ClientOptions): Coordination {
  const client = createClient(options);
  return { origin: options.origin,
    createDecision: (agentId, input, signal) => data(client.call(operations.createRuntimeDecision, { agentId }, input, undefined, signal)),
    pollDecision: (agentId, decisionId, signal) => data(client.call(operations.pollRuntimeDecision, { agentId, decisionId }, {}, undefined, signal)),
    receiptDecision: (agentId, decisionId, status, signal) => data(client.call(operations.receiptRuntimeDecision, { agentId, decisionId }, { status }, undefined, signal)),
    runtime: (agentId, runId, input, signal) => data(client.call(operations.reportRuntime, { agentId, runId }, input, undefined, signal)),
    release: signal => data(client.call(operations.release, {}, {}, undefined, signal)),
    delivery: (agentId, signal) => data(client.call(operations.deliveryPolicy, { agentId }, {}, undefined, signal)),
    ownerConversation: (agentId, signal) => data(client.call(operations.ownerConversation, { agentId }, {}, undefined, signal)),
    acceptInvitation: (agentId, roomId, signal) => data(client.call(operations.acceptRoomInvitation, { agentId }, { roomId }, undefined, signal)),
    identities: (backendUserIds, signal) => data(client.call(operations.resolvePrincipals, {}, { backendUserIds: [...backendUserIds] }, undefined, signal)),
    report: (agentId, runId, input, signal) => data(client.call(operations.reportListener, { agentId, runId }, input, undefined, signal)),
    notice: (agentId, roomId, eventId, signal) => data(client.call(operations.wakeNotice, { agentId, eventId }, { roomId }, undefined, signal)),
    wakeMetadata: (agentId, attachment, signal) => data(client.call(operations.wakeMetadata, { agentId }, {}, new URLSearchParams(attachment), signal)),
    claimWake: (agentId, attachment, signal) => data(client.call(operations.claimWake, { agentId }, attachment, undefined, signal)),
    validateWake: (agentId, deliveryId, attachment, signal) => data(client.call(operations.validateWake, { agentId, deliveryId }, {}, new URLSearchParams(attachment), signal)),
    acknowledgeWake: (agentId, deliveryId, attachment, signal) => data(client.call(operations.acknowledgeWake, { agentId, deliveryId }, attachment, undefined, signal)),
  };
}
