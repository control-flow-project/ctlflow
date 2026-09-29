import * as check from './validation.js';
import { grant } from './response.js';
import { grantIntent } from './request.js';
export const preview = check.object({ digest: check.text(64, 64), snapshots: check.list(check.object({ agentId: check.identifier, revision: check.integer(),
  grants: check.list(check.object({ roomId: check.roomId, generation: check.identifier, revision: check.integer() }), 100) }), 100),
  changes: check.list(check.object({ agentId: check.identifier, roomId: check.roomId, before: check.nullable(grant),
    after: check.nullable(grantIntent), changed: check.boolean, authorizerId: check.identifier,
    nativePowerLevel: check.nullable(check.integer(Number.MIN_SAFE_INTEGER)) }), 10000) });
export const changed = check.object({ accepted: check.boolean, agents: check.list(check.identifier, 100) });
