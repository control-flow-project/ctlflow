import { operations } from '../../../../../packages/contracts/src/rest/operations.js';
import { createSession } from '../../../../../packages/domain/src/session/create-session.js';
import { endSession } from '../../../../../packages/domain/src/session/authenticate.js';
import { success } from '../../../../../packages/kernel/src/result.js';
import { bind, missingSession } from '../bind.js';
import { member } from '../representation/identity.js';
export function sessionRoutes() {
  return [
    bind(operations.createSession, async (context, _params, _query, input) => {
      const result = await createSession(context.services, input.nativeAccessToken);
      return result.ok ? success({ data: { member: member(result.value.member), csrfSecret: result.value.csrfSecret, permissions: result.value.permissions }, cookie: result.value.secret }) : result;
    }),
    bind(operations.currentSession, context => context.session ? success({ data: { member: member(context.session.member),
      csrfSecret: context.session.csrfSecret, permissions: context.session.permissions } }) : missingSession()),
    bind(operations.endSession, context => {
      const result = endSession(context.services, context.credential);
      return result.ok ? success({ data: { accepted: true }, cookie: null }) : result;
    }),
  ];
}
