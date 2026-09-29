import { operations } from '@crossfire/contracts/rest/operations';
import { createSession } from '@crossfire/domain/session/create-session';
import { endSession } from '@crossfire/domain/session/authenticate';
import { success } from '@crossfire/kernel/result';
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
