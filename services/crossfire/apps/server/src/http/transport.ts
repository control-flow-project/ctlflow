import type { IncomingMessage, ServerResponse } from 'node:http';
import { failure, success, type FailureCode, type Result } from '@crossfire/kernel/result';
import { HTTP_LIMITS } from '@crossfire/contracts/rest/limits';
import type { Reply } from './bind.js';
export const COOKIE_NAME = 'crossfire';
const failureStatus: Record<FailureCode, number> = { invalid: 400, unauthorized: 401, forbidden: 403, missing: 404, conflict: 409, limit: 413, native: 502, unavailable: 503,
  stale_revision: 409, name_collision: 409, capacity: 409, rate_limit: 429, body_too_large: 413, method_not_allowed: 405 };
export function cookie(request: IncomingMessage): string {
  const parts = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(COOKIE_NAME + '='));
  if (parts.length !== 1) return '';
  const value = parts[0]!.slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : '';
}
async function readText(request: IncomingMessage, contentType: string, limit: number): Promise<Result<string>> {
  if (request.headers['content-type']?.split(';', 1)[0] !== contentType) return failure('invalid', 'Expected ' + contentType);
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > limit) return failure('body_too_large', 'Request body exceeds the configured bound');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) return failure('body_too_large', 'Request body exceeds the configured bound');
    chunks.push(buffer);
  }
  return success(Buffer.concat(chunks).toString('utf8'));
}
export async function readBody(request: IncomingMessage): Promise<Result<unknown>> {
  const body = await readText(request, 'application/json', HTTP_LIMITS.requestBytes);
  if (!body.ok) return body;
  try { return success(JSON.parse(body.value)); }
  catch { return failure('invalid', 'Invalid JSON'); }
}
export async function readForm(request: IncomingMessage): Promise<Result<URLSearchParams>> {
  const body = await readText(request, 'application/x-www-form-urlencoded', 1024);
  return body.ok ? success(new URLSearchParams(body.value)) : body;
}
export function send(response: ServerResponse, requestId: string, result: Result<Reply>, status = 200): void {
  let serialized = JSON.stringify(result.ok ? { data: result.value.data, meta: { requestId, ...result.value.pagination } }
    : { error: result.error, meta: { requestId } });
  let code = result.ok ? status : failureStatus[result.error.code];
  if (Buffer.byteLength(serialized) > HTTP_LIMITS.responseBytes) {
    code = 503;
    serialized = JSON.stringify({ error: { code: 'unavailable', message: 'Response exceeds the finite output bound' }, meta: { requestId } });
  }
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Request-ID': requestId });
  response.end(serialized);
}
export function setCookie(response: ServerResponse, credential: string | null, origin: string): void {
  response.setHeader('Set-Cookie', COOKIE_NAME + '=' + (credential ?? '') + '; Path=/; HttpOnly; SameSite=Strict'
    + (origin.startsWith('https:') ? '; Secure' : '') + '; Max-Age=' + (credential === null ? '0' : '28800'));
}
