import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { readFleetMap } from '@ctlflow/crossfire-domain/fleet/read-map';
import { fleetMap } from '../representation/fleet-map.js';
import { changeFleetDelivery, reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import { createFleetMessage, listFleetMessages, readFleetControl, acknowledgeFleetMessage } from '@ctlflow/crossfire-domain/fleet/message';
import { bind, actor, fleetActor, paged, reply } from '../bind.js';
import { readFleetStatistics } from '@ctlflow/crossfire-domain/fleet/read-statistics';
import { listFleetRuntime, requestFleetRuntime, claimFleetRuntime, receiptFleetRuntime } from '@ctlflow/crossfire-domain/fleet/runtime';

export function fleetRoutes() {
  return [
    bind(operations.fleetRuntimeOperations, (context, params, query) => paged(listFleetRuntime(context.services, fleetActor(context), params.fleetId, query))),
    bind(operations.requestFleetRuntime, (context, params, _query, input) => reply(requestFleetRuntime(context.services, actor(context), params.fleetId, input, context.requestId))),
    bind(operations.claimFleetRuntime, (context, params, _query, input) => reply(claimFleetRuntime(context.services, fleetActor(context), params.fleetId, params.operationId, input.connectionId))),
    bind(operations.receiptFleetRuntime, (context, params, _query, input) => reply(receiptFleetRuntime(context.services, fleetActor(context), params.fleetId, params.operationId, input))),
    bind(operations.fleetStatistics, (context, params, query) => reply(readFleetStatistics(context.services, actor(context), params.fleetId, query))),
    bind(operations.fleetMap, async (context, params) => reply(await readFleetMap(context.services, actor(context), params.fleetId), fleetMap)),
    bind(operations.changeFleetDelivery, (context, params, _query, input) => reply(changeFleetDelivery(context.services, fleetActor(context), params.fleetId, input, context.requestId))),
    bind(operations.reportFleetConnection, (context, params, _query, input) => reply(reportFleetConnection(context.services, fleetActor(context), params.fleetId, params.connectionId, input.stopped))),
    bind(operations.fleetControl, async (context, params, query) => {
      const version = context.fleetChanges.version(params.fleetId);
      const result = readFleetControl(context.services, fleetActor(context), params.fleetId, query.connectionId);
      if (!result.ok || result.value.revision !== query.revision || result.value.messages.length || result.value.runtimeOperations.length) return reply(result);
      const waited = await context.fleetChanges.wait(params.fleetId, version, query.waitMs, context.signal);
      return waited.ok ? reply(readFleetControl(context.services, fleetActor(context), params.fleetId, query.connectionId)) : waited;
    }),
    bind(operations.fleetMessages, (context, params, query) => paged(listFleetMessages(context.services, fleetActor(context), params.fleetId, query))),
    bind(operations.createFleetMessage, (context, params, _query, input) => reply(createFleetMessage(context.services, fleetActor(context), params.fleetId, input, context.requestId))),
    bind(operations.acknowledgeFleetMessage, (context, params, _query, input) => reply(acknowledgeFleetMessage(context.services, fleetActor(context), params.fleetId, params.messageId, params.agentId, input))),
  ];
}
