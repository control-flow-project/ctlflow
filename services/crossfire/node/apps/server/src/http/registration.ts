import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Services } from '@ctlflow/crossfire-domain/port/services';
import { registerMember, verifyInvitation } from '@ctlflow/crossfire-domain/member/registration';
import { readBody, readForm } from './transport.js';
import { registrationPage } from './registration-page.js';
export const registrationStage = 'org.crossfire.login.registration';
type Invitation = { id: string; secret: string };
type RegistrationSession = { expiresAt: number; authorized: boolean; invitation: Invitation | null;
  details: { username: string; password: string; deviceId: string } | null; confirmation: { invitation: Invitation | null; nonce: string } | null };
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
function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function registrationTransport(services: Services) {
  const sessions = new Map<string, RegistrationSession>();
  const pending = new Set<string>();
  function expire() { for (const [id, session] of sessions) if (session.expiresAt <= services.clock.now()) sessions.delete(id); }
  return { register: async (request: IncomingMessage, response: ServerResponse, requestId: string) => {
    const respond = (status: number, body: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body)); };
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); respond(405, { errcode: 'M_UNRECOGNIZED', error: 'Use POST' }); return; }
    const parsed = await readBody(request);
    if (!parsed.ok) { respond(400, { errcode: 'M_BAD_JSON', error: parsed.error.message }); return; }
    const input = object(parsed.value), auth = object(input.auth), now = services.clock.now();
    expire();
    const policy = services.repositories.instancePolicy.find({ id: 'instance' });
    if (!policy.ok || !policy.value) { respond(503, { errcode: 'M_UNKNOWN', error: 'Signup policy unavailable' }); return; }
    if (input.kind === 'guest' || request.url?.includes('kind=guest')) { respond(403, { errcode: 'M_FORBIDDEN', error: 'Guest registration is disabled' }); return; }
    let session = typeof auth.session === 'string' ? sessions.get(auth.session) : undefined;
    if (auth.session !== undefined && !session) { respond(400, { errcode: 'M_UNKNOWN', error: 'Signup session is invalid or expired; restart registration' }); return; }
    if (!session) {
      if (sessions.size >= 1000) { respond(429, { errcode: 'M_LIMIT_EXCEEDED', error: 'Too many signup attempts', retry_after_ms: 60000 }); return; }
      const id = randomUUID();
      session = { expiresAt: now + 600000, authorized: false,
        invitation: null, details: null, confirmation: null };
      sessions.set(id, session);
      auth.session = id;
    }
    if (input.username !== undefined || input.password !== undefined || input.device_id !== undefined) {
      if (typeof input.username !== 'string' || typeof input.password !== 'string' || !/^[a-z0-9][a-z0-9._=\-]{0,99}$/u.test(input.username)
        || input.password.length < 12 || input.password.length > 1024 || (input.device_id !== undefined && (typeof input.device_id !== 'string' || !input.device_id || input.device_id.length > 100))) {
        respond(400, { errcode: 'M_INVALID_PARAM', error: 'Choose a valid username and a password of at least 12 characters' }); return;
      }
      const details = { username: input.username, password: input.password, deviceId: typeof input.device_id === 'string' ? input.device_id : session.details?.deviceId ?? randomUUID() };
      if (session.details && JSON.stringify(session.details) !== JSON.stringify(details)) { respond(400, { errcode: 'M_INVALID_PARAM', error: 'Account details changed; restart registration' }); return; }
      session.details = details;
    }
    if (auth.type !== undefined && auth.type !== registrationStage) { respond(400, { errcode: 'M_UNRECOGNIZED', error: 'Unsupported authentication stage' }); return; }
    if (!session.authorized) { respond(401, { session: auth.session, flows: [{ stages: [registrationStage] }], params: {}, completed: [] }); return; }
    if (!session.details) { respond(400, { errcode: 'M_MISSING_PARAM', error: 'Username and password are required' }); return; }
    const details = session.details;
    if (pending.has(details.username)) { respond(409, { errcode: 'M_USER_IN_USE', error: 'This username is being registered' }); return; }
    pending.add(details.username);
    try {
      const result = await registerMember(services, details, session.invitation, requestId);
      if (!result.ok) { respond(result.error.code === 'forbidden' || result.error.code === 'unauthorized' ? 403 : result.error.code === 'conflict' ? 400 : result.error.code === 'native' ? 502 : 400,
        { errcode: result.error.code === 'conflict' ? 'M_USER_IN_USE' : result.error.code === 'forbidden' || result.error.code === 'unauthorized' ? 'M_FORBIDDEN' : 'M_UNKNOWN', error: result.error.message }); return; }
      sessions.delete(String(auth.session));
      setInvitationCookie(response, null);
      respond(200, { user_id: result.value.userId, access_token: result.value.accessToken, device_id: result.value.deviceId,
        home_server: services.instance.serverName });
    } finally { pending.delete(details.username); }
  }, fallback: async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    expire();
    const sessionId = url.searchParams.get('session'), session = sessionId ? sessions.get(sessionId) : undefined;
    const fail = (status: number, message: string) => registrationPage(response, status, { message });
    if (url.searchParams.size !== 1 || !session || !session.details) { fail(400, 'This signup session is invalid or expired. Return to Element and restart signup.'); return; }
    if (request.method !== 'GET' && request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); fail(405, 'Use the invitation confirmation in Element.'); return; }
    const invitation = invitationCookie(request);
    const policy = services.repositories.instancePolicy.find({ id: 'instance' });
    if (!policy.ok || !policy.value) { fail(503, 'Signup policy is unavailable. Try again later.'); return; }
    if (invitation ? !verifyInvitation(services, invitation.id, invitation.secret).ok : policy.value.signupMode !== 'open') {
      fail(403, 'Open your complete private invitation link in this browser, then return to Element to finish signup.'); return;
    }
    if (request.method === 'GET') {
      session.confirmation = { invitation, nonce: services.identity.secret() };
      registrationPage(response, 200, { username: session.details.username, server: services.instance.serverName, nonce: session.confirmation.nonce, invited: invitation !== null }); return;
    }
    if (request.headers.origin !== services.instance.publicOrigin) { fail(403, 'Confirm the invitation from this server’s signup page.'); return; }
    const form = await readForm(request), confirmation = session.confirmation;
    if (!form.ok || form.value.size !== 1 || !confirmation || form.value.get('nonce') !== confirmation.nonce
      || JSON.stringify(invitation) !== JSON.stringify(confirmation.invitation)) { fail(403, 'Account confirmation expired. Reopen it from Element.'); return; }
    session.invitation = invitation;
    session.authorized = true;
    session.confirmation = null;
    setInvitationCookie(response, null);
    registrationPage(response, 200, { completed: true });
  } };
}
