import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { discoverPrincipals, readRoles, readPermissions } from '@ctlflow/crossfire-domain/authorization/discover';
import { resolvePrincipals } from '@ctlflow/crossfire-domain/identity/resolve-principals';
import { readPolicy } from '@ctlflow/crossfire-domain/policy/read-policy';
import { changeInstancePolicy } from '@ctlflow/crossfire-domain/policy/change-policy';
import { readAuditEvents } from '@ctlflow/crossfire-domain/audit/read-events';
import { success } from '@ctlflow/crossfire-kernel/result';
import { bind, reply, paged, actor } from '../bind.js';
import * as view from '../representation/instance.js';
export function instanceRoutes(instance: string, startedAt: number, loggingError: () => string | null) {
  return [
    bind(operations.messagingBackend, context => success({ data: context.services.messaging.describe(context.services.instance.publicOrigin) })),
    bind(operations.authenticateBackend, async (context, _params, _query, input) => {
      const result = await context.services.messaging.authenticate(input.username, input.password);
      return result.ok ? success({ data: { accessToken: result.value } }) : result;
    }),
    bind(operations.principals, (context, _params, query) => paged(discoverPrincipals(context.services, actor(context), query))),
    bind(operations.resolvePrincipals, (context, _params, _query, input) => reply(resolvePrincipals(context.services, actor(context), input.backendUserIds))),
    bind(operations.roles, context => reply(readRoles(context.services, actor(context)))),
    bind(operations.permissions, context => reply(readPermissions(context.services, actor(context)))),
    bind(operations.policy, context => reply(readPolicy(context.services, actor(context)), view.policy)),
    bind(operations.changePolicy, (context, _params, _query, input) => {
      const result = changeInstancePolicy(context.services, actor(context), input, context.requestId);
      return result.ok ? reply(readPolicy(context.services, actor(context)), view.policy) : result;
    }),
    bind(operations.audit, (context, _params, query) => paged(readAuditEvents(context.services, actor(context), query), view.audit)),
    bind(operations.release, context => success({ data: context.manifest })),
    bind(operations.health, context => success({ data: { instance, release: context.manifest.release, version: context.manifest.version, startedAt,
      loggingRetentionDays: context.services.logging.days, loggingError: loggingError() } })),
  ];
}
