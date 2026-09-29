import { operations } from '../../../../../packages/contracts/src/rest/operations.js';
import { discoverPrincipals, readRoles, readPermissions } from '../../../../../packages/domain/src/authorization/discover.js';
import { readPolicy } from '../../../../../packages/domain/src/policy/read-policy.js';
import { changeInstancePolicy } from '../../../../../packages/domain/src/policy/change-policy.js';
import { readAuditEvents } from '../../../../../packages/domain/src/audit/read-events.js';
import { success } from '../../../../../packages/kernel/src/result.js';
import { bind, reply, paged, actor } from '../bind.js';
import * as view from '../representation/instance.js';
export function instanceRoutes(instance: string, startedAt: number) {
  return [
    bind(operations.principals, (context, _params, query) => paged(discoverPrincipals(context.services, actor(context), query))),
    bind(operations.roles, context => reply(readRoles(context.services, actor(context)))),
    bind(operations.permissions, context => reply(readPermissions(context.services, actor(context)))),
    bind(operations.policy, context => reply(readPolicy(context.services, actor(context)), view.policy)),
    bind(operations.changePolicy, (context, _params, _query, input) => {
      const result = changeInstancePolicy(context.services, actor(context), input, context.requestId);
      return result.ok ? reply(readPolicy(context.services, actor(context)), view.policy) : result;
    }),
    bind(operations.audit, (context, _params, query) => paged(readAuditEvents(context.services, actor(context), query), view.audit)),
    bind(operations.release, context => success({ data: context.manifest })),
    bind(operations.health, context => success({ data: { instance, release: context.manifest.release, version: context.manifest.version, startedAt } })),
  ];
}
