import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

type ServeFile = (root: string, path: string, response: ServerResponse, head: boolean) => void;
type Routes = { publicOrigin: string; service: Server; web: string;
  backend(request: IncomingMessage, response: ServerResponse, url: URL, serve: ServeFile): boolean };
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
    if (path.startsWith('/api/') || path.startsWith('/onboarding/')) { routes.service.emit('request', request, response); return; }
    if (path !== '/manage' && !path.startsWith('/manage/')) {
      if (!routes.backend(request, response, url, staticFile)) { response.writeHead(404); response.end('Not found'); }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405); response.end(); return; }
    response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Frame-Options', 'DENY');
    if (path === '/manage' || path.startsWith('/manage/')) {
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      staticFile(routes.web, path.startsWith('/manage/assets/') ? path.slice('/manage'.length) : '/index.html', response, request.method === 'HEAD');
    }
  });
}
