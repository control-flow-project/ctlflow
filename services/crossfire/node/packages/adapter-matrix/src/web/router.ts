import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { forwardMatrix } from './proxy.js';

export type ServeFile = (root: string, path: string, response: ServerResponse, head: boolean) => void;
export function matrixPublicRoutes(routes: { publicOrigin: string; matrixOrigin: string; service: Server; element: string }) {
  return (request: IncomingMessage, response: ServerResponse, url: URL, serve: ServeFile): boolean => {
    const path = url.pathname;
    const native = path.startsWith('/_matrix/');
    let decodedPath = path;
    try { if (native) decodedPath = decodeURIComponent(path); }
    catch { response.writeHead(400); response.end('Invalid request path encoding'); return true; }
    const registration = path === '/_matrix/client/v3/register';
    const fallback = path === '/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web';
    const exact = (request.url ?? '/').split('?')[0] === path;
    const profile = request.method === 'PUT' && /^\/_matrix\/client\/v3\/profile\/[^/]+\/displayname$/u.test(path);
    if (request.method === 'PUT' && /^\/_matrix\/client\/(?:.*\/)?profile\/[^/]+\/displayname\/*$/u.test(decodedPath) && (!profile || !exact)
      || ((!registration || !exact) && /^\/_matrix\/client\/(?:.*\/)?register\/*$/u.test(decodedPath))
      || ((!fallback || !exact) && /^\/_matrix\/client\/(?:.*\/)?auth\/org\.crossfire\.login\.registration\/fallback\/web\/*$/u.test(decodedPath))) {
      response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ errcode: 'M_UNRECOGNIZED', error: 'Unsupported native path' })); return true;
    }
    const configuration = path === '/config.json' || path === '/config.' + new URL(routes.publicOrigin).hostname + '.json';
    if (profile || path === '/_matrix/client/v3/user_directory/search' || registration || fallback || configuration) {
      routes.service.emit('request', request, response); return true;
    }
    if (native) {
      forwardMatrix(request, response, routes.matrixOrigin, routes.publicOrigin); return true;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405); response.end(); return true; }
    response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Frame-Options', 'DENY');
    if (path === '/.well-known/matrix/client') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ 'm.homeserver': { base_url: routes.publicOrigin } })); return true;
    }
    if (path === '/usercontent/' || path === '/usercontent/index.html') {
      response.removeHeader('X-Frame-Options'); response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    }
    serve(routes.element, path, response, request.method === 'HEAD'); return true;
  };
}
