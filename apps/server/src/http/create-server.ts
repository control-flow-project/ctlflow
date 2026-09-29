import { createServer, type IncomingMessage } from 'node:http';
import { failure, success, type Result } from '../../../../packages/kernel/src/result.js';
import { HTTP_LIMITS } from '../../../../packages/contracts/src/rest/limits.js';
import { matrixUserId } from '../../../../packages/contracts/src/schema/validation.js';
import { onboardingGuide } from '../../../../packages/contracts/src/onboarding.js';
import { authenticateMember, authenticateAgent } from '../../../../packages/domain/src/session/authenticate.js';
import type { Application } from '../composition.js';
import type { createWorker } from '../worker.js';
import type { Release } from '../../../../packages/files/src/release.js';
import { serveArtifact } from '../artifacts.js';
import { type Context, type Endpoint, type Reply } from './bind.js';
import { readBody, send, cookie, setCookie } from './transport.js';
import { sessionRoutes } from './routes/session.js';
import { enrollmentRoutes } from './routes/enrollment.js';
import { agentRoutes } from './routes/agent.js';
import { roomRoutes } from './routes/room.js';
import { memberRoutes } from './routes/member.js';
import { instanceRoutes } from './routes/instance.js';
export function createHttpServer(application: Application, worker: ReturnType<typeof createWorker>, release: Release) {
  const { services, config } = application;
  const endpoints = [...sessionRoutes(), ...enrollmentRoutes(), ...agentRoutes(), ...roomRoutes(), ...memberRoutes(),
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
  async function authenticate(request: IncomingMessage, endpoint: Endpoint, requestId: string): Promise<Result<Context>> {
    const authorization = request.headers.authorization, credential = cookie(request);
    const mutation = request.method !== 'GET';
    if (authorization !== undefined && request.headers.cookie !== undefined) return failure('invalid', 'Do not mix cookie and bearer authentication');
    const context: Context = { services, requestId, actor: null, session: null, credential, manifest: release.manifest };
    if (endpoint.auth === 'public') {
      if (authorization !== undefined) return failure('invalid', 'This operation does not accept bearer authentication');
      return success(context);
    }
    if (authorization !== undefined) {
      if (endpoint.auth === 'human' || !/^Bearer [^\s]+$/u.test(authorization)) return failure('unauthorized', 'This operation requires the correct authentication kind');
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
    try {
      const url = new URL(request.url ?? '/', config.publicOrigin);
      if (url.origin !== config.publicOrigin || request.headers.host !== new URL(config.publicOrigin).host) { send(response, requestId, failure('forbidden', 'Invalid request host')); return; }
      if (request.headers.origin !== undefined && request.headers.origin !== config.publicOrigin) { send(response, requestId, failure('forbidden', 'Invalid request origin')); return; }
      const method = request.method ?? 'GET';
      if (serveArtifact(release, method, url.pathname, response)) return;
      if (url.pathname === '/onboarding/setup') {
        const owner = matrixUserId(url.searchParams.get('ownerMatrixId'));
        if (!owner.ok || url.searchParams.size !== 1 || method !== 'GET') { send(response, requestId, failure('invalid', 'GET requires exactly one ownerMatrixId')); return; }
        const guide = Buffer.from(onboardingGuide(config.publicOrigin, owner.value, release.manifest));
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': guide.length, 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        response.end(guide); return;
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
      const authenticated = await authenticate(request, endpoint, requestId);
      if (!authenticated.ok) { send(response, requestId, authenticated); return; }
      const input = method === 'GET' ? success({}) : await readBody(request);
      if (!input.ok) { send(response, requestId, input); return; }
      const result: Result<Reply> = await endpoint.invoke(authenticated.value, params, url.searchParams, input.value);
      if (result.ok && result.value.cookie !== undefined) setCookie(response, result.value.cookie, config.publicOrigin);
      send(response, requestId, result, endpoint.status);
      if (result.ok && method !== 'GET') worker.wake();
    } catch {
      send(response, requestId, failure('unavailable', 'The operation could not be completed; request ID: ' + requestId));
    }
  });
}
