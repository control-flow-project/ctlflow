import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Services } from '@ctlflow/crossfire-domain/port/services';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { verifyInvitation } from '@ctlflow/crossfire-domain/member/registration';
import { registrationTransport, registrationStage } from './registration.js';
import { changeMatrixProfile } from './profile.js';
import { searchMatrixDirectory } from './directory.js';
import type { WebTransport } from './transport.js';

export function createMatrixHttp(services: Services, configuration: { publicOrigin: string; serverName: string }, transport: WebTransport) {
  const register = registrationTransport(services, configuration.serverName, transport);
  return (presentation: Record<string, unknown>, admit: (request: IncomingMessage) => Result<void>) => {
    function admitted(request: IncomingMessage, response: ServerResponse, requestId: string): boolean {
      const result = admit(request);
      if (result.ok) return true;
      const limited = result.error.code === 'rate_limit';
      response.writeHead(limited ? 429 : 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Request-ID': requestId, ...(limited ? { 'Retry-After': '60' } : {}) });
      response.end(JSON.stringify({ errcode: limited ? 'M_LIMIT_EXCEEDED' : 'M_FORBIDDEN', error: result.error.message }));
      return false;
    }
    return async (request: IncomingMessage, response: ServerResponse, url: URL, requestId: string): Promise<boolean> => {
      const method = request.method ?? 'GET';
      if (method === 'PUT' && /^\/_matrix\/client\/v3\/profile\/[^/]+\/displayname$/u.test(url.pathname)) {
        await changeMatrixProfile(services, request, response, url, requestId, transport); return true;
      }
      if (url.pathname === '/_matrix/client/v3/user_directory/search') {
        await searchMatrixDirectory(services, request, response, url, requestId, transport); return true;
      }
      if (url.pathname === '/_matrix/client/v3/register') {
        if (admitted(request, response, requestId)) await register.register(request, response, requestId);
        return true;
      }
      if (url.pathname === '/_matrix/client/v3/auth/' + registrationStage + '/fallback/web') {
        if (method !== 'POST' || admitted(request, response, requestId)) await register.fallback(request, response, url);
        return true;
      }
      if (url.pathname !== '/config.json' && url.pathname !== '/config.' + new URL(configuration.publicOrigin).hostname + '.json') return false;
      if (method !== 'GET' && method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return true; }
      const policy = services.repositories.instancePolicy.find({ id: 'instance' });
      const claim = transport.invitationCookie(request);
      const invited = claim && verifyInvitation(services, claim.id, claim.secret).ok;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(method === 'HEAD' ? undefined : JSON.stringify({ brand: 'crossfire', default_theme: 'light', ...presentation,
        custom_translations_url: '/manage/assets/element-translations.json',
        default_server_config: { 'm.homeserver': { base_url: configuration.publicOrigin, server_name: configuration.serverName } },
        disable_custom_urls: true, disable_guests: true, disable_login_language_selector: true, disable_3pid_login: true,
        disable_registration: !invited && !(policy.ok && policy.value?.signupMode === 'open'), room_directory: { servers: [] } }));
      return true;
    };
  };
}
