import { operations } from '@crossfire/contracts/rest/operations';
import { readFleetMap } from '@crossfire/domain/fleet/read-map';
import { fleetMap } from '../representation/fleet-map.js';
import { changeFleetDelivery, reportFleetConnection } from '@crossfire/domain/fleet/control';
import { createFleetMessage, listFleetMessages, readFleetControl, acknowledgeFleetMessage } from '@crossfire/domain/fleet/message';
import { bind, actor, fleetActor, paged, reply } from '../bind.js';

export function fleetRoutes() {
  return [
    bind(operations.fleetMap, async (context, params) => reply(await readFleetMap(context.services, actor(context), params.fleetId), fleetMap)),
    bind(operations.changeFleetDelivery, (context, params, _query, input) => reply(changeFleetDelivery(context.services, fleetActor(context), params.fleetId, input, context.requestId))),
    bind(operations.reportFleetConnection, (context, params, _query, input) => reply(reportFleetConnection(context.services, fleetActor(context), params.fleetId, params.connectionId, input.stopped))),
    bind(operations.fleetControl, async (context, params, query) => {
      const version = context.fleetChanges.version(params.fleetId);
      const result = readFleetControl(context.services, fleetActor(context), params.fleetId, query.connectionId);
      if (!result.ok || result.value.revision !== query.revision || result.value.messages.length) return reply(result);
      const waited = await context.fleetChanges.wait(params.fleetId, version, query.waitMs, context.signal);
      return waited.ok ? reply(readFleetControl(context.services, fleetActor(context), params.fleetId, query.connectionId)) : waited;
    }),
    bind(operations.fleetMessages, (context, params, query) => paged(listFleetMessages(context.services, fleetActor(context), params.fleetId, query))),
    bind(operations.createFleetMessage, (context, params, _query, input) => reply(createFleetMessage(context.services, fleetActor(context), params.fleetId, input, context.requestId))),
    bind(operations.acknowledgeFleetMessage, (context, params, _query, input) => reply(acknowledgeFleetMessage(context.services, fleetActor(context), params.fleetId, params.messageId, params.agentId, input))),
  ];
}
