import { request as httpRequest, type IncomingMessage, type ServerResponse, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const maximumRequest = 64 * 1024 * 1024;
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'cookie', 'set-cookie'];

function headers(input: IncomingHttpHeaders, upstream: boolean): IncomingHttpHeaders {
  const excluded = new Set([...hopHeaders, ...(input.connection ?? '').split(',').map(token => token.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(input).filter(([name]) => !excluded.has(name)
    && (!upstream || name !== 'host' && name !== 'forwarded' && !name.startsWith('x-forwarded-'))));
}

export function forwardMatrix(request: IncomingMessage, response: ServerResponse, origin: string, publicOrigin: string): void {
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method ?? '')) { response.writeHead(405); response.end(); return; }
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maximumRequest)) { response.writeHead(413); response.end(); request.resume(); return; }
  const target = new URL(origin), hostname = target.hostname.replace(/^\[|\]$/gu, ''), forward = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const outgoing = { ...headers(request.headers, true), host: new URL(publicOrigin).host };
  let tooLarge = false;
  const upstream = forward({ protocol: target.protocol, hostname, port: target.port, method: request.method,
    path: request.url, headers: outgoing, timeout: 110000, servername: isIP(hostname) ? '' : hostname }, incoming => {
    if (incoming.statusCode !== undefined && incoming.statusCode >= 300 && incoming.statusCode < 400 && incoming.statusCode !== 304) {
      incoming.destroy(); response.writeHead(502); response.end(); return;
    }
    response.writeHead(incoming.statusCode ?? 502, headers(incoming.headers, false));
    incoming.on('error', () => response.destroy()); incoming.pipe(response);
  });
  let received = 0;
  request.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received <= maximumRequest || tooLarge) return;
    tooLarge = true; request.unpipe(upstream); upstream.destroy();
    if (response.headersSent) response.destroy(); else { response.writeHead(413); response.end(); }
    request.resume();
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Upstream deadline')));
  upstream.on('error', () => { if (tooLarge || response.destroyed) return; if (response.headersSent) response.destroy(); else { response.writeHead(502); response.end(); } });
  response.on('close', () => upstream.destroy()); request.on('error', () => upstream.destroy()); request.pipe(upstream);
}
