import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateNativePrincipal } from '@ctlflow/crossfire-domain/session/authenticate';
import { changeMember } from '@ctlflow/crossfire-domain/member/change-member';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import type { Services } from '@ctlflow/crossfire-domain/port/services';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { HUMAN_SIGNUP } from '@ctlflow/crossfire-contracts/policy';
import { readBody } from './transport.js';

export async function changeMatrixProfile(services: Services, request: IncomingMessage, response: ServerResponse, url: URL, requestId: string) {
  function reply(status: number, errcode?: string, error?: string) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId });
    response.end(JSON.stringify(errcode ? { errcode, error } : {}));
  }
  if (url.searchParams.size) { reply(400, 'M_INVALID_PARAM', 'Use native bearer authentication without query credentials'); return; }
  const authorization = request.headers.authorization;
  if (!authorization || !/^Bearer [^\s]+$/u.test(authorization)) { reply(401, 'M_MISSING_TOKEN', 'Native bearer authentication is required'); return; }
  const actor = await authenticateNativePrincipal(services, authorization.slice(7));
  if (!actor.ok) { reply(actor.error.code === 'unauthorized' ? 401 : 403, actor.error.code === 'unauthorized' ? 'M_UNKNOWN_TOKEN' : 'M_FORBIDDEN', actor.error.message); return; }
  if (actor.value.kind === 'agent') { reply(403, 'M_FORBIDDEN', 'Agent names are registered through owner-reviewed fleet enrollment'); return; }
  const member = services.directory.member(actor.value.principalId);
  if (!member.ok || !member.value) { reply(503, 'M_UNKNOWN', 'Registered profile unavailable'); return; }
  const userId = decodeURIComponent(url.pathname.split('/')[5]!);
  if (userId !== member.value.principal.matrixUserId) { reply(403, 'M_FORBIDDEN', 'You can only change your own profile'); return; }
  const body = await readBody(request);
  const input = body.ok ? check.object({ displayname: check.text(HUMAN_SIGNUP.labelMax) })(body.value) : body;
  if (!input.ok) { reply(input.error.code === 'body_too_large' ? 413 : 400, 'M_INVALID_PARAM', input.error.message); return; }
  const changed = changeMember(services, actor.value, actor.value.principalId,
    { expectedRevision: member.value.principal.revision, displayName: input.value.displayname }, requestId);
  if (!changed.ok) { reply(changed.error.code === 'conflict' ? 409 : 403, 'M_FORBIDDEN', changed.error.message); return; }
  const applied = await reconcilePrincipal(services, actor.value.principalId);
  if (!applied.ok) { reply(502, 'M_UNKNOWN', applied.error.message); return; }
  reply(200);
}
