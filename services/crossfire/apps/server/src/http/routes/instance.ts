import { operations } from '@crossfire/contracts/rest/operations';
import { discoverPrincipals, readRoles, readPermissions } from '@crossfire/domain/authorization/discover';
import { readPolicy } from '@crossfire/domain/policy/read-policy';
import { changeInstancePolicy } from '@crossfire/domain/policy/change-policy';
import { readAuditEvents } from '@crossfire/domain/audit/read-events';
import { success } from '@crossfire/kernel/result';
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
