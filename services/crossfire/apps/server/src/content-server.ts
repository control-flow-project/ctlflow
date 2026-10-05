import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { publicationPath } from '@crossfire/domain/publication/validation';
import type { Application } from './composition.js';

const contentSecurity = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const maximumReads = 32;

export function createContentServer(application: Application) {
  let active = 0;
  async function serve(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', contentSecurity);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const end = (status: number) => { response.statusCode = status; response.end(); };
    if (request.headers.host !== new URL(application.config.contentOrigin).host) { end(421); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') { response.setHeader('Allow', 'GET, HEAD, OPTIONS'); end(405); return; }
    const match = /^\/([A-Za-z0-9_-]{43})\/([^?#]+)(?:\?[^#]*)?$/u.exec(request.url ?? '');
    if (!match || !publicationPath(match[2]!).ok) { end(404); return; }
    const repository = application.services.publication.repository;
    const record = repository.publicFile(match[1]!, match[2]!);
    if (!record.ok) { end(503); return; }
    if (!record.value) { end(404); return; }
    if (request.method === 'OPTIONS') { end(204); return; }
    if (active >= maximumReads) { end(503); return; }
    active++;
    const stop = new AbortController();
    const closed = () => stop.abort(); response.once('close', closed);
    const deadline = setTimeout(() => { stop.abort(); response.destroy(); }, 30_000); deadline.unref();
    let source: Awaited<ReturnType<typeof application.services.publication.store.read>> | undefined;
    try {
      source = await application.services.publication.store.read(record.value.publication.id, record.value.file);
      if (!source.ok) { end(503); return; }
      const current = repository.publicFile(match[1]!, match[2]!);
      if (!current.ok || !current.value) { end(current.ok ? 404 : 503); return; }
      response.setHeader('Content-Type', record.value.file.mediaType);
      response.setHeader('Content-Length', record.value.file.bytes);
      if (request.method === 'HEAD') { end(200); return; }
      for await (const chunk of source.value.chunks) {
        if (stop.signal.aborted) break;
        const current = repository.publicFile(match[1]!, match[2]!);
        if (!current.ok || !current.value) { response.destroy(); break; }
        if (!response.write(chunk)) await once(response, 'drain', { signal: stop.signal });
      }
      if (!response.destroyed) response.end();
    } catch {
      if (response.headersSent) response.destroy(); else if (!response.destroyed) end(503);
    } finally {
      clearTimeout(deadline);
      response.off('close', closed);
      try { if (source?.ok) await source.value.close(); } finally { active--; }
    }
  }
  const server = createServer((request, response) => { void serve(request, response).catch(() => {
    if (response.headersSent) response.destroy(); else if (!response.destroyed) { response.statusCode = 503; response.end(); }
  }); });
  server.maxConnections = 64; server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 1000;
  return server;
}
