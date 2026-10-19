import type { IncomingMessage, ServerResponse } from 'node:http';
const invitationCookieName = '__Host-crossfire-invitation';
export function setInvitationCookie(response: ServerResponse, value: string | null) {
  response.setHeader('Set-Cookie', invitationCookieName + '=' + (value ?? '') + '; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=' + (value === null ? 0 : 600));
}
export function invitationCookie(request: IncomingMessage) {
  const parts = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(invitationCookieName + '='));
  if (parts.length !== 1) return null;
  const matched = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/u.exec(parts[0]!.slice(invitationCookieName.length + 1));
  return matched ? { id: matched[1]!, secret: matched[2]! } : null;
}
