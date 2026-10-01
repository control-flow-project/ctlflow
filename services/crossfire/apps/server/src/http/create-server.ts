import { authenticateController } from '@crossfire/domain/fleet/authority';
import { createServer, type IncomingMessage } from 'node:http';
import { failure, success, type Result } from '@crossfire/kernel/result';
import { HTTP_LIMITS } from '@crossfire/contracts/rest/limits';
import { matrixUserId } from '@crossfire/contracts/schema/validation';
import { onboardingGuide } from '@crossfire/contracts/onboarding';
import { authenticateMember, authenticateAgent } from '@crossfire/domain/session/authenticate';
import type { Application } from '../composition.js';
import type { createWorker } from '../worker.js';
import type { Release } from '@crossfire/adapter-filesystem/release';
import type { ElementPresentation } from '../element-configuration.js';
import { serveArtifact } from '../artifacts.js';
import { type Context, type Endpoint, type Reply } from './bind.js';
import { readBody, send, cookie, setCookie } from './transport.js';
import { sessionRoutes } from './routes/session.js';
import { enrollmentRoutes } from './routes/enrollment.js';
import { fleetRoutes } from './routes/fleet.js';
import { createFleetChanges } from './fleet-changes.js';
import { agentRoutes } from './routes/agent.js';
import { roomRoutes } from './routes/room.js';
import { memberRoutes } from './routes/member.js';
import { instanceRoutes } from './routes/instance.js';
import { registrationTransport, invitationCookie, setInvitationCookie, registrationStage } from './registration.js';
import { verifyInvitation } from '@crossfire/domain/member/registration';
import { searchMatrixDirectory } from './matrix-directory.js';
export function createHttpServer(application: Application, worker: ReturnType<typeof createWorker>, release: Release, presentation: ElementPresentation = {}) {
  const { services, config } = application;
  const register = registrationTransport(services);
  const fleetChanges = createFleetChanges();
  const endpoints = [...sessionRoutes(), ...enrollmentRoutes(), ...fleetRoutes(), ...agentRoutes(), ...roomRoutes(), ...memberRoutes(),
    ...instanceRoutes(config.instance, services.clock.now())];
  const limits = new Map<string, { count: number; expiresAt: number }>();
  function rate(request: IncomingMessage): boolean {
    const now = services.clock.now();
    for (const [key, entry] of limits) if (entry.expiresAt <= now) limits.delete(key);
    const key = request.socket.remoteAddress ?? 'unknown';
    const entry = limits.get(key) ?? { count: 0, expiresAt: now + 60_000 };
    if (!limits.has(key) && limits.size >= 4096) return false;
    entry.count++; limits.set(key, entry);
    return entry.count <= HTTP_LIMITS.publicMutationsPerMinute;
  }
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
      if (url.pathname === '/_matrix/client/v3/user_directory/search') {
        await searchMatrixDirectory(services, request, response, url, requestId); return;
      }
      if (/^\/_matrix\/client\/(?:v3|r0)\/register$/u.test(url.pathname)) {
        if (!rate(request)) { response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); response.end(JSON.stringify({ errcode: 'M_LIMIT_EXCEEDED', error: 'Too many signup requests' })); return; }
        await register.register(request, response, requestId); if (response.statusCode === 200) worker.wake(); return;
      }
      if (url.pathname === '/_matrix/client/v3/auth/' + registrationStage + '/fallback/web') {
        if (method === 'POST' && !rate(request)) { response.writeHead(429, { 'Retry-After': '60' }); response.end('Too many signup requests'); return; }
        await register.fallback(request, response, url); return;
      }
      if (url.pathname === '/config.json' || url.pathname === '/config.' + new URL(config.publicOrigin).hostname + '.json') {
        if (method !== 'GET' && method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
        const policy = services.repositories.instancePolicy.find({ id: 'instance' });
        const claim = invitationCookie(request);
        const invited = claim && verifyInvitation(services, claim.id, claim.secret).ok;
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(method === 'HEAD' ? undefined : JSON.stringify({ brand: 'Crossfire', default_theme: 'light', ...presentation,
          default_server_config: { 'm.homeserver': { base_url: config.publicOrigin, server_name: config.serverName } },
          disable_custom_urls: true, disable_guests: true, disable_login_language_selector: true, disable_3pid_login: true,
          disable_registration: !invited && !(policy.ok && policy.value?.signupMode === 'open'), room_directory: { servers: [] } })); return;
      }
      if (serveArtifact(release, method, url.pathname, response)) return;
      if (url.pathname === '/onboarding/setup') {
        if (method !== 'GET' && method !== 'HEAD') {
          response.setHeader('Allow', 'GET, HEAD'); send(response, requestId, failure('method_not_allowed', 'Method not allowed')); return;
        }
        const owner = matrixUserId(url.searchParams.get('ownerMatrixId'));
        if (!owner.ok || url.searchParams.size !== 1) { send(response, requestId, failure('invalid', 'Exactly one ownerMatrixId is required')); return; }
        const policy = services.repositories.instancePolicy.find({ id: 'instance' });
        if (!policy.ok || !policy.value) { send(response, requestId, failure('unavailable', 'Onboarding policy unavailable')); return; }
        const guide = Buffer.from(onboardingGuide(config.publicOrigin, owner.value, release.manifest, policy.value.agentInstructions));
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': guide.length, 'Cache-Control': 'no-store',
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
      if (endpoint.auth === 'public' && method !== 'GET' && !rate(request)) {
        response.setHeader('Retry-After', '60');
        send(response, requestId, failure('rate_limit', 'Request rate exceeded')); return;
      }
      if (endpoint.path === '/api/sessions' && request.headers.origin !== config.publicOrigin) { send(response, requestId, failure('forbidden', 'Same-origin human login required')); return; }
      if (endpoint.path.endsWith('/claim') && request.headers.origin !== config.publicOrigin) { send(response, requestId, failure('forbidden', 'Same-origin invitation claim required')); return; }
      const authenticated = await authenticate(request, endpoint, requestId, stop.signal);
      if (!authenticated.ok) { send(response, requestId, authenticated); return; }
      const input = method === 'GET' ? success({}) : await readBody(request);
      if (!input.ok) { send(response, requestId, input); return; }
      const result: Result<Reply> = await endpoint.invoke(authenticated.value, params, url.searchParams, input.value);
      if (result.ok && result.value.cookie !== undefined) setCookie(response, result.value.cookie, config.publicOrigin);
      if (result.ok && result.value.invitationCookie !== undefined) setInvitationCookie(response, result.value.invitationCookie, config.publicOrigin);
      send(response, requestId, result, endpoint.status);
      if (result.ok && method !== 'GET') { worker.wake(); fleetChanges.notify(params.fleetId); }
    } catch {
      send(response, requestId, failure('unavailable', 'The operation could not be completed; request ID: ' + requestId));
    }
  });
}
