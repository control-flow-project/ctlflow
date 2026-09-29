import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { applicationFixture } from './support/application.js';
import { httpFixture } from './support/http.js';
import { contractRelease } from './support/release.js';
import { onboardingCommand, onboardingUrl } from '@crossfire/contracts/onboarding';

test("HTTP management enforces cookie, origin, CSRF, strict requests and removed routes", async scope => {
  const fixture = await applicationFixture(scope), { request, origin } = await httpFixture(scope, fixture.application);
  const release = contractRelease(), ctx = { config: fixture.application.config };
  assert.equal((await request("/api/agents")).status, 401);
  for (const path of ["/_coord/install.mjs", "/_coord/client", "/_coord/dm", "/_coord/rooms", "/_matrix/client/v3/sync"]) {
    assert.equal((await request(path)).status, 404);
  }
  assert.equal((await request("/api/health?unknown=true")).status, 400);
  const setupUrl = onboardingUrl(origin, ctx.config.administrator);
  const setup = await fetch(setupUrl);
  assert.equal(setup.status, 200);
  assert.equal(setup.headers.get('cache-control'), 'no-store');
  assert.equal(setup.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(setup.headers.get('x-content-type-options'), 'nosniff');
  const guide = await setup.text();
  assert(guide.includes(onboardingCommand(origin, ctx.config.administrator, release.manifest)));
  assert(!guide.includes(ctx.config.jwtSecret));
  assert(!guide.includes(ctx.config.registrationSecret));
  const head = await fetch(setupUrl, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(guide)));
  assert.equal(await head.text(), '');
  const denied = await fetch(setupUrl, { method: 'POST' });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('allow'), 'GET, HEAD');
  for (const query of ['', '?ownerMatrixId=', '?ownerMatrixId=invalid', '?ownerMatrixId=%40admin%0A%3Atests.localhost',
    '?ownerMatrixId=%40admin%3Atests.localhost&ownerMatrixId=%40other%3Atests.localhost', '?ownerMatrixId=%40admin%3Atests.localhost&unknown=true']) {
    assert.equal((await request('/onboarding/setup' + query)).status, 400, query);
  }
  const quotedOwner = "@o'connor:tests.localhost";
  const quoted = await fetch(onboardingUrl(origin, quotedOwner));
  assert.equal(quoted.status, 200, 'The public guide does not look up accounts or authorize enrollment');
  assert((await quoted.text()).includes(onboardingCommand(origin, quotedOwner, release.manifest)));
  const invalidHost = await new Promise<number>((resolve, reject) => {
    const outgoing = httpRequest(setupUrl, { headers: { Host: 'attacker.invalid' } }, response => {
      response.resume(); resolve(response.statusCode!);
    });
    outgoing.on('error', reject); outgoing.end();
  });
  assert.equal(invalidHost, 403);
  assert.equal((await request("/api/sessions", "POST", { nativeAccessToken: fixture.admin.token }, { Origin: "https://attacker.invalid" })).status, 403);
  const login = await request("/api/sessions", "POST", { nativeAccessToken: fixture.admin.token }, { Origin: origin });
  assert.equal(login.status, 201);
  const cookies = login.headers.get("set-cookie")!;
  assert(cookies.includes("HttpOnly") && cookies.includes("SameSite=Strict"));
  const cookie = cookies.split(";", 1)[0]!;
  const result = await login.json() as { data: { csrfSecret: string } };
  assert.equal(JSON.stringify(result).includes("sessionHash"), false);
  const auth = { Cookie: cookie, Origin: origin, "X-Crossfire-CSRF": result.data.csrfSecret };
  assert.equal((await request("/api/member-invitations", "POST", { roleCode: "member", expiresSeconds: 60 }, { Cookie: cookie, Origin: origin })).status, 403);
  assert.equal((await request("/api/member-invitations", "POST", { roleCode: "member", expiresSeconds: 60, unknown: true }, auth)).status, 400);
  const invitation = await request("/api/member-invitations", "POST", { roleCode: "member", expiresSeconds: 60 }, auth);
  assert.equal(invitation.status, 201);
  const created = await invitation.json() as { data: { claimSecret: string } };
  const list = await request("/api/member-invitations", "GET", undefined, { Cookie: cookie });
  assert.equal(list.status, 200);
  const publicView = await list.text();
  assert.equal(publicView.includes(created.data.claimSecret), false);
  assert.equal(publicView.includes("secretHash"), false);
  assert.equal(publicView.includes("claimHash"), false);
  assert.equal((await request("/api/agents?pageSize=1&pageSize=2", "GET", undefined, { Cookie: cookie })).status, 400);
  assert.equal((await request("/api/sessions/current", "DELETE", {}, auth)).status, 200);
  assert.equal((await request("/api/sessions/current", "GET", undefined, { Cookie: cookie })).status, 401);
});
