import { createServer, request as forward, type ServerResponse, type IncomingHttpHeaders } from 'node:http';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

type Routes = { publicOrigin: string; matrixOrigin: string; serviceOrigin: string; web: string; element: string };
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

function staticFile(root: string, path: string, response: ServerResponse, head: boolean): void {
  try {
    const relative = decodeURIComponent(path).replace(/^\//u, '');
    if (relative.includes('\0') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part.startsWith('.'))) throw new Error('Invalid asset path');
    const file = realpathSync(resolve(root, relative.endsWith('/') ? relative + 'index.html' : relative || 'index.html'));
    if (!file.startsWith(realpathSync(root) + sep)) throw new Error('Asset outside root');
    const info = statSync(file);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size,
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    if (head) response.end(); else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch { response.writeHead(404); response.end('Not found'); }
}

export function publicRouter(routes: Routes) {
  return createServer({ requestTimeout: 120_000, headersTimeout: 10_000 }, (request, response) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', routes.publicOrigin); }
    catch { response.writeHead(400); response.end('Invalid request URL'); return; }
    if (url.origin !== routes.publicOrigin || request.headers.host !== new URL(routes.publicOrigin).host) {
      response.writeHead(403); response.end('Invalid host'); return;
    }
    const path = url.pathname;
    const native = path.startsWith('/_matrix/');
    let decodedPath = path;
    try { if (native) decodedPath = decodeURIComponent(path); }
    catch { response.writeHead(400); response.end('Invalid request path encoding'); return; }
    const registration = path === '/_matrix/client/v3/register';
    const registrationAuthentication = path === '/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web';
    const exactPath = (request.url ?? '/').split('?')[0] === path;
    const profileWrite = request.method === 'PUT' && /^\/_matrix\/client\/v3\/profile\/[^/]+\/displayname$/u.test(path);
    if (request.method === 'PUT' && /^\/_matrix\/client\/(?:.*\/)?profile\/[^/]+\/displayname\/*$/u.test(decodedPath)
      && (!profileWrite || !exactPath)) {
      response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ errcode: 'M_UNRECOGNIZED', error: 'Unsupported profile path' })); return;
    }
    if (((!registration || !exactPath) && /^\/_matrix\/client\/(?:.*\/)?register\/*$/u.test(decodedPath))
      || ((!registrationAuthentication || !exactPath) && /^\/_matrix\/client\/(?:.*\/)?auth\/org\.crossfire\.login\.registration\/fallback\/web\/*$/u.test(decodedPath))) {
      response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ errcode: 'M_UNRECOGNIZED', error: 'Unsupported registration path' })); return;
    }
    const elementConfiguration = path === '/config.json' || path === '/config.' + new URL(routes.publicOrigin).hostname + '.json';
    const management = profileWrite || path === '/_matrix/client/v3/user_directory/search' || registration || registrationAuthentication || elementConfiguration || path.startsWith('/api/') || path.startsWith('/onboarding/');
    if (native || management) {
      const target = new URL(management ? routes.serviceOrigin : routes.matrixOrigin);
      const headers: IncomingHttpHeaders = { ...request.headers, host: new URL(routes.publicOrigin).host };
      delete headers['forwarded']; delete headers['x-forwarded-for']; delete headers['x-forwarded-host'];
      const upstream = forward({ hostname: target.hostname, port: target.port, method: request.method,
        path: request.url, headers, timeout: 110_000 }, incoming => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.on('error', () => response.destroy()); incoming.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('Upstream deadline')));
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      response.on('close', () => upstream.destroy());
      request.on('error', () => upstream.destroy()); request.pipe(upstream); return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405); response.end(); return; }
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    if (path === '/.well-known/matrix/client') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      const homeserver = { base_url: routes.publicOrigin };
      response.end(JSON.stringify({ 'm.homeserver': homeserver })); return;
    }
    if (path === '/manage' || path.startsWith('/manage/')) {
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      staticFile(routes.web, path.startsWith('/manage/assets/') ? path.slice('/manage'.length) : '/index.html', response, request.method === 'HEAD');
    } else {
      if (path === '/usercontent/' || path === '/usercontent/index.html') {
        response.removeHeader('X-Frame-Options');
        response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
      }
      staticFile(routes.element, path, response, request.method === 'HEAD');
    }
  });
}
