import assert from 'node:assert/strict';
import test from 'node:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { cookie, setCookie } from '../apps/server/src/http/transport.js';
import { invitationCookie, setInvitationCookie } from '../apps/server/src/http/invitation-cookie.js';

const credential = 'a'.repeat(43), invitation = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.' + credential;

function request(value: string) { const input = new IncomingMessage(new Socket()); input.headers.cookie = value; return input; }
function header(set: (response: ServerResponse) => void): string {
  const response = new ServerResponse(request('')); set(response); return String(response.getHeader('Set-Cookie'));
}

test('one host-prefixed secure cookie per purpose has no insecure or old-name transport', () => {
  for (const [name, set, value] of [
    ['__Host-crossfire', setCookie, credential], ['__Host-crossfire-invitation', setInvitationCookie, invitation],
  ] as const) {
    for (const input of [value, null]) {
      const actual = header(response => set(response, input));
      assert(actual.startsWith(name + '=' + (input ?? '') + ';')); assert.match(actual, /; Secure(?:;|$)/u);
      assert.match(actual, /; HttpOnly(?:;|$)/u); assert.match(actual, /; SameSite=Strict(?:;|$)/u);
      assert.match(actual, /; Path=\/(?:;|$)/u); assert(!/Domain=/iu.test(actual));
      if (input === null) assert.match(actual, /Max-Age=0$/u);
    }
  }
  assert.equal(cookie(request('__Host-crossfire=' + credential)), credential);
  assert.deepEqual(invitationCookie(request('__Host-crossfire-invitation=' + invitation)), { id: invitation.slice(0, 36), secret: credential });
  for (const value of ['', 'crossfire=' + credential, '__Host-crossfire=malformed', '__Host-crossfire=' + credential + '; __Host-crossfire=' + credential]) assert.equal(cookie(request(value)), '');
  for (const value of ['', 'crossfire_invitation=' + invitation, '__Host-crossfire-invitation=malformed', '__Host-crossfire-invitation=' + invitation + '; __Host-crossfire-invitation=' + invitation]) assert.equal(invitationCookie(request(value)), null);
});
