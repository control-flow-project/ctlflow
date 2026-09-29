import { operations } from '../../../../../packages/contracts/src/rest/operations.js';
import { readRoom, listRooms, listRoomMembers, createRoom } from '../../../../../packages/domain/src/room/read-room.js';
import { changeMembership } from '../../../../../packages/domain/src/room/change-membership.js';
import { readRoomGrant, listRoomGrants } from '../../../../../packages/domain/src/room-access/read-grants.js';
import { changeRoomGrant } from '../../../../../packages/domain/src/room-access/change-grant.js';
import { setRoomPermission } from '../../../../../packages/domain/src/room-access/set-permission.js';
import { previewGrantPlan, applyGrantPlan } from '../../../../../packages/domain/src/room-access/grant-plan.js';
import { bind, reply, paged, actor, acknowledged } from '../bind.js';
import * as view from '../representation/room.js';
export function roomRoutes() {
  return [
    bind(operations.rooms, async (context, _params, query) => paged(await listRooms(context.services, actor(context), query), view.room)),
    bind(operations.room, async (context, params, query) => reply(await readRoom(context.services, actor(context), params.roomId, query.agentId), view.room)),
    bind(operations.createRoom, async (context, _params, _query, input) => reply(await createRoom(context.services, actor(context), input.name))),
    bind(operations.roomMembers, async (context, params, query) => paged(await listRoomMembers(context.services, actor(context), params.roomId, query))),
    bind(operations.changeMembership, async (context, params, _query, input) => acknowledged(await changeMembership(context.services, actor(context), params.roomId, input, context.requestId))),
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
