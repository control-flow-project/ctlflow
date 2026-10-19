import type { IncomingMessage, ServerResponse } from 'node:http';
import { matrixDirectorySearch, type MatrixDirectoryResult } from '../directory.js';
import type { Failure } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '@ctlflow/crossfire-domain/port/services';
import { authenticateNativePrincipal } from '@ctlflow/crossfire-domain/session/authenticate';
import { discoverPrincipals } from '@ctlflow/crossfire-domain/authorization/discover';
import type { WebTransport } from './transport.js';

export async function searchMatrixDirectory(services: Services, request: IncomingMessage, response: ServerResponse, url: URL, requestId: string, transport: WebTransport) {
  function reply(status: number, body: MatrixDirectoryResult | { errcode: string; error: string }) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId });
    response.end(JSON.stringify(body));
  }
  function reject(error: Failure) {
    const status = error.code === 'unauthorized' ? 401 : error.code === 'forbidden' ? 403 : error.code === 'body_too_large' ? 413
      : error.code === 'native' ? 502 : error.code === 'unavailable' ? 503 : 400;
    reply(status, { errcode: status === 401 ? 'M_UNKNOWN_TOKEN' : status === 403 ? 'M_FORBIDDEN' : status === 413 ? 'M_TOO_LARGE' : status >= 500 ? 'M_UNKNOWN' : 'M_INVALID_PARAM', error: error.message });
  }
  try {
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); reply(405, { errcode: 'M_UNRECOGNIZED', error: 'Use POST' }); return; }
    if (url.searchParams.size) { reply(400, { errcode: 'M_INVALID_PARAM', error: 'Search parameters belong in the request body' }); return; }
    const authorization = request.headers.authorization;
    if (!authorization || !/^Bearer [^\s]+$/u.test(authorization)) { reply(401, { errcode: 'M_MISSING_TOKEN', error: 'Native bearer authentication is required' }); return; }
    const actor = await authenticateNativePrincipal(services, authorization.slice(7));
    if (!actor.ok) { reject(actor.error); return; }
    const body = await transport.readBody(request);
    if (!body.ok) { reject(body.error); return; }
    const input = matrixDirectorySearch(body.value);
    if (!input.ok) { reject(input.error); return; }
    const limit = input.value.limit ?? 10;
    const directory = discoverPrincipals(services, actor.value, { page: 1, pageSize: Math.max(1, limit), kind: 'all', search: input.value.search_term });
    if (!directory.ok) { reject(directory.error); return; }
    const results = directory.value.items.slice(0, limit).map(principal => ({ user_id: principal.backendUserId, display_name: principal.displayName }));
    reply(200, { results, limited: directory.value.totalItems > results.length });
  } catch { reply(503, { errcode: 'M_UNKNOWN', error: 'Directory search unavailable; request ID: ' + requestId }); }
}
