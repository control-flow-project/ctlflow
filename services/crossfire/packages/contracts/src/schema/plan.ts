import * as check from './validation.js';
import { grant, roomAuthority } from './response.js';
import { grantIntent } from './request.js';
export const preview = check.object({ digest: check.text(64, 64), snapshots: check.list(check.object({ agentId: check.identifier, revision: check.integer(),
  grants: check.list(check.object({ roomId: check.roomId, generation: check.identifier, revision: check.integer() }), 100) }), 100),
  changes: check.list(check.object({ agentId: check.identifier, roomId: check.roomId, before: check.nullable(grant),
    agentName: check.text(255), instanceKey: check.name, roomName: check.text(255), roomAlias: check.nullable(check.text(255)),
    after: check.nullable(grantIntent), changed: check.boolean, authorizerId: check.identifier,
    authority: check.nullable(roomAuthority) }), 10000) });
export const changed = check.object({ accepted: check.boolean, agents: check.list(check.identifier, 100) });
