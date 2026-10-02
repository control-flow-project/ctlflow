import { operations } from '@crossfire/contracts/rest/operations';
import { readRoom, listRooms } from '@crossfire/domain/room/read-room';
import { readRoomGrant, listRoomGrants } from '@crossfire/domain/room-access/read-grants';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { setRoomPermission } from '@crossfire/domain/room-access/set-permission';
import { acceptRoomInvitation } from '@crossfire/domain/room-access/accept-invitation';
import { previewGrantPlan, applyGrantPlan } from '@crossfire/domain/room-access/grant-plan';
import { bind, reply, paged, actor } from '../bind.js';
import * as view from '../representation/room.js';
export function roomRoutes() {
  return [
    bind(operations.acceptRoomInvitation, async (context, params, _query, input) => reply(await acceptRoomInvitation(
      context.services, actor(context), params.agentId, input.roomId, context.requestId))),
    bind(operations.rooms, async (context, _params, query) => paged(await listRooms(context.services, actor(context), query), view.room)),
    bind(operations.room, async (context, params, query) => reply(await readRoom(context.services, actor(context), params.roomId, query.agentId), view.room)),
    bind(operations.grants, (context, params, query) => paged(listRoomGrants(context.services, actor(context), params.agentId, query), view.grantView)),
    bind(operations.grant, async (context, params) => reply(await readRoomGrant(context.services, actor(context), params.agentId, params.roomId), view.grantView)),
    bind(operations.setGrant, async (context, params, _query, input) => {
      const result = await changeRoomGrant(context.services, actor(context), { ...input, ...params }, context.requestId);
      return result.ok ? reply(await readRoomGrant(context.services, actor(context), params.agentId, params.roomId), view.grantView) : result;
    }),
    bind(operations.removeGrant, async (context, params, _query, input) => {
      const result = await changeRoomGrant(context.services, actor(context), { ...input, ...params, accessMode: 'none', powerLevel: null, muted: false }, context.requestId);
      return result.ok ? reply(await readRoomGrant(context.services, actor(context), params.agentId, params.roomId), view.grantView) : result;
    }),
    bind(operations.grantPermissions, async (context, params) => reply(await readRoomGrant(context.services, actor(context), params.agentId, params.roomId), view.grantView)),
    bind(operations.setGrantPermissions, async (context, params, _query, input) => {
      const result = setRoomPermission(context.services, actor(context), { ...input, ...params }, context.requestId);
      return result.ok ? reply(await readRoomGrant(context.services, actor(context), params.agentId, params.roomId), view.grantView) : result;
    }),
    bind(operations.previewGrants, async (context, _params, _query, input) => reply(await previewGrantPlan(context.services, actor(context), input.plan), view.plan)),
    bind(operations.applyGrants, async (context, _params, _query, input) => reply(await applyGrantPlan(context.services, actor(context), input, context.requestId))),
  ];
}
