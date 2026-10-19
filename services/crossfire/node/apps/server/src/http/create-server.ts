import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { createServer, type IncomingMessage } from 'node:http';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { HTTP_LIMITS } from '@ctlflow/crossfire-contracts/rest/limits';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { backendUserId } from '@ctlflow/crossfire-contracts/schema/validation';
import { onboardingGuide, setupDescriptor } from '@ctlflow/crossfire-contracts/onboarding';
import { authenticateMember, authenticateAgent } from '@ctlflow/crossfire-domain/session/authenticate';
import type { Application } from '../composition.js';
import type { createWorker } from '../worker.js';
import type { Release } from '@ctlflow/crossfire-adapter-filesystem/release';
import { serveArtifact } from '../artifacts.js';
import { type Context, type Endpoint, type Reply } from './bind.js';
import { readBody, send, cookie, setCookie } from './transport.js';
import { sessionRoutes } from './routes/session.js';
import { enrollmentRoutes } from './routes/enrollment.js';
import { fleetRoutes } from './routes/fleet.js';
import { createFleetChanges } from './fleet-changes.js';
import { agentRoutes } from './routes/agent.js';
import { wakeUpRoutes } from './routes/wake-up.js';
import { roomRoutes } from './routes/room.js';
import { memberRoutes } from './routes/member.js';
import { instanceRoutes } from './routes/instance.js';
import { runtimeRoutes } from './routes/runtime.js';
import { publicationRoutes } from './routes/publication.js';
import { readBinary } from './binary.js';
import { setInvitationCookie } from './invitation-cookie.js';
import { publicRequestBudget } from './public-request-budget.js';
export function createHttpServer(application: Application, worker: ReturnType<typeof createWorker>, release: Release, presentation: Record<string, unknown> = {}) {
  const { services, config } = application;
  const fleetChanges = createFleetChanges();
  const endpoints = [...sessionRoutes(), ...enrollmentRoutes(), ...fleetRoutes(), ...agentRoutes(), ...wakeUpRoutes(), ...roomRoutes(), ...memberRoutes(),
    ...runtimeRoutes(), ...publicationRoutes(), ...instanceRoutes(config.instance, services.clock.now(), application.diagnostics.error)];
  const rate = publicRequestBudget(services.clock.now, config.trustedProxyAddresses);
  const native = application.messagingHttp(presentation, request => { const result = rate(request); return result.ok ? success(undefined) : result; });
  async function authenticate(request: IncomingMessage, endpoint: Endpoint, requestId: string, signal: AbortSignal): Promise<Result<Context>> {
    const authorization = request.headers.authorization, credential = cookie(request);
    const mutation = request.method !== 'GET';
    if (authorization !== undefined && request.headers.cookie !== undefined) return failure('invalid', 'Do not mix cookie and bearer authentication');
    const context: Context = { services, requestId, actor: null, session: null, credential, manifest: release.manifest, signal, fleetChanges };
    if (endpoint.auth === 'public') {
      if (authorization !== undefined) return failure('invalid', 'This operation does not accept bearer authentication');
      return success(context);
    }
    if (authorization !== undefined) {
      if (endpoint.auth === 'human' || !/^Bearer [^\s]+$/u.test(authorization)) return failure('unauthorized', 'This operation requires the correct authentication kind');
      if (endpoint.auth === 'fleet') {
        const controller = authenticateController(services, authorization.slice(7));
        return controller.ok ? success({ ...context, controller: controller.value }) : controller;
      }
      const result = await authenticateAgent(services, authorization.slice(7));
      return result.ok ? success({ ...context, actor: result.value }) : result;
    }
    if (endpoint.auth === 'agent') return failure('unauthorized', 'Agent bearer authentication is required');
    const csrf = request.headers['x-crossfire-csrf'];
    if (mutation && (request.headers.origin !== config.publicOrigin || typeof csrf !== 'string')) return failure('forbidden', 'Same-origin CSRF-protected mutation required');
    const result = await authenticateMember(services, credential, mutation && typeof csrf === 'string' ? csrf : undefined);
    return result.ok ? success({ ...context, actor: result.value.actor, session: result.value }) : result;
  }
  return createServer({ requestTimeout: HTTP_LIMITS.requestMilliseconds, headersTimeout: 10_000 }, async (request, response) => {
    const requestId = services.identity.id();
    const stop = new AbortController();
    response.once('close', () => stop.abort(new Error('HTTP connection closed')));
    try {
      const url = new URL(request.url ?? '/', config.publicOrigin);
      if (url.origin !== config.publicOrigin || request.headers.host !== new URL(config.publicOrigin).host) { send(response, requestId, failure('forbidden', 'Invalid request host')); return; }
      if (request.headers.origin !== undefined && request.headers.origin !== config.publicOrigin) { send(response, requestId, failure('forbidden', 'Invalid request origin')); return; }
      const method = request.method ?? 'GET';
      if (await native(request, response, url, requestId)) { if (method !== 'GET' && response.statusCode === 200) worker.wake(); return; }
      if (serveArtifact(release, method, url.pathname, response)) return;
      if (url.pathname === '/onboarding/setup' || url.pathname === '/onboarding/setup.json') {
        if (method !== 'GET' && method !== 'HEAD') {
          response.setHeader('Allow', 'GET, HEAD'); send(response, requestId, failure('method_not_allowed', 'Method not allowed')); return;
        }
        const owner = backendUserId(url.searchParams.get('ownerBackendUserId'));
        if (!owner.ok || url.searchParams.size !== 1) { send(response, requestId, failure('invalid', 'Exactly one ownerBackendUserId is required')); return; }
        const principal = services.directory.principalByBackendUserId(owner.value);
        if (!principal.ok) { send(response, requestId, principal); return; }
        if (!principal.value || principal.value.kind !== 'human' || principal.value.status !== 'active') { send(response, requestId, failure('forbidden', 'An active registered human owner is required')); return; }
        const policy = services.repositories.instancePolicy.find({ id: 'instance' });
        if (!policy.ok || !policy.value) { send(response, requestId, failure('unavailable', 'Onboarding policy unavailable')); return; }
        const structured = url.pathname === '/onboarding/setup.json';
        const guide = Buffer.from(structured ? JSON.stringify(setupDescriptor(config.publicOrigin, owner.value, release.manifest, policy.value.agentInstructions))
          : onboardingGuide(config.publicOrigin, owner.value, release.manifest, policy.value.agentInstructions));
        response.writeHead(200, { 'Content-Type': structured ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Length': guide.length, 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        response.end(method === 'HEAD' ? undefined : guide); return;
      }
      let endpoint: Endpoint | undefined, params: Record<string, string> | undefined;
      const allowed = new Set<string>();
      let matchedPath: string | undefined;
      for (const candidate of endpoints) {
        if (matchedPath !== undefined && candidate.path !== matchedPath) continue;
        const matched = candidate.match(url.pathname);
        if (!matched) continue;
        matchedPath = candidate.path;
        allowed.add(candidate.method);
        if (candidate.method === method) { endpoint = candidate; params = matched; break; }
      }
      if (!endpoint || !params) {
        if (allowed.size) { response.setHeader('Allow', [...allowed].join(', ')); send(response, requestId, failure('method_not_allowed', 'Method not allowed')); }
        else send(response, requestId, failure('missing', 'Route not found'));
        return;
      }
      if (endpoint.auth === 'public' && method !== 'GET') {
        const admitted = rate(request);
        if (!admitted.ok) { if (admitted.error.code === 'rate_limit') response.setHeader('Retry-After', '60'); send(response, requestId, admitted); return; }
      }
      if ((endpoint.path === '/api/sessions' || endpoint.path === operations.authenticateBackend.path) && request.headers.origin !== config.publicOrigin) { send(response, requestId, failure('forbidden', 'Same-origin human login required')); return; }
      if (endpoint.path === operations.claimInvitation.path && request.headers.origin !== config.publicOrigin) { send(response, requestId, failure('forbidden', 'Same-origin invitation claim required')); return; }
      const authenticated = await authenticate(request, endpoint, requestId, stop.signal);
      if (!authenticated.ok) { send(response, requestId, authenticated); return; }
      const input = method === 'GET' ? success({}) : endpoint.requestFormat === 'binary'
        ? readBinary(request, endpoint.requestBytes!) : await readBody(request, endpoint.requestBytes);
      if (!input.ok) { send(response, requestId, input); return; }
      const result: Result<Reply> = await endpoint.invoke(authenticated.value, params, url.searchParams, input.value);
      if (result.ok && result.value.cookie !== undefined) setCookie(response, result.value.cookie);
      if (result.ok && result.value.invitationCookie !== undefined) setInvitationCookie(response, result.value.invitationCookie);
      send(response, requestId, result, endpoint.status);
      if (result.ok && method !== 'GET') { worker.wake(); fleetChanges.notify(params.fleetId); }
    } catch {
      send(response, requestId, failure('unavailable', 'The operation could not be completed; request ID: ' + requestId));
    }
  });
}
