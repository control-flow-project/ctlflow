import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from 'node:http';
import test from "node:test";
import { openStore } from "../apps/server/src/data/database.js";
import { context, secret, type Context } from "../apps/server/src/context.js";
import { success } from "../packages/contracts/src/result.js";
import { httpService } from "../apps/server/src/http.js";
import { releaseFixture } from "./release-fixture.js";
import { onboardingCommand, onboardingUrl } from '../packages/contracts/src/onboarding.js';

test("HTTP management enforces cookie, origin, CSRF, strict requests and removed routes", async scope => {
  const store = openStore(":memory:");
  const initial = context(store, { instance: "tests", serverName: "tests.localhost", publicOrigin: "http://127.0.0.1",
    matrixOrigin: "http://127.0.0.1", administrator: "@admin:tests.localhost", registrationSecret: secret(), jwtSecret: secret() });
  const ctx: Context = { ...initial, native: { ...initial.native, identify: async () => success(initial.config.administrator) } };
  let woken = 0;
  const release = await releaseFixture();
  const server = httpService(ctx, { wake: () => { woken++; }, drain: async () => {}, stop: async () => {} }, release);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = "http://127.0.0.1:" + address.port;
  ctx.config.publicOrigin = origin;
  scope.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  async function request(path: string, method = "GET", input?: unknown, headers: Record<string, string> = {}) {
    return fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...headers },
      redirect: "error", signal: AbortSignal.timeout(10_000), ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  }
  assert.equal((await request("/_coord/agents")).status, 401);
  for (const path of ["/_coord/install.mjs", "/_coord/client", "/_coord/dm", "/_coord/rooms", "/_matrix/client/v3/sync"]) {
    assert.equal((await request(path)).status, 404);
  }
  assert.equal((await request("/_coord/health?unknown=true")).status, 400);
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
  for (const query of ['', '?owner=', '?owner=invalid', '?owner=%40admin%0A%3Atests.localhost',
    '?owner=%40admin%3Atests.localhost&owner=%40other%3Atests.localhost', '?owner=%40admin%3Atests.localhost&unknown=true']) {
    assert.equal((await request('/_coord/setup' + query)).status, 400, query);
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
  assert.equal((await request("/_coord/session", "POST", { token: "native" }, { Origin: "https://attacker.invalid" })).status, 403);
  const login = await request("/_coord/session", "POST", { token: "native" }, { Origin: origin });
  assert.equal(login.status, 200);
  const cookies = login.headers.get("set-cookie")!;
  assert(cookies.includes("HttpOnly") && cookies.includes("SameSite=Strict"));
  const cookie = cookies.split(";", 1)[0]!;
  const result = await login.json() as { human: { id: string }; csrf: string };
  assert.equal(JSON.stringify(result).includes("sessionHash"), false);
  const auth = { Cookie: cookie, Origin: origin, "X-Crossfire-CSRF": result.csrf };
  assert.equal((await request("/_coord/invitations", "POST", { role: "member", expiresSeconds: 60 }, { Cookie: cookie, Origin: origin })).status, 403);
  assert.equal((await request("/_coord/invitations", "POST", { role: "member", expiresSeconds: 60, unknown: true }, auth)).status, 400);
  const invitation = await request("/_coord/invitations", "POST", { role: "member", expiresSeconds: 60 }, auth);
  assert.equal(invitation.status, 200);
  const created = await invitation.json() as { secret: string };
  const list = await request("/_coord/invitations", "GET", undefined, { Cookie: cookie });
  assert.equal(list.status, 200);
  const publicView = await list.text();
  assert.equal(publicView.includes(created.secret), false);
  assert.equal(publicView.includes("secretHash"), false);
  assert.equal(publicView.includes("claimHash"), false);
  assert.equal((await request("/_coord/agents?limit=1&limit=2", "GET", undefined, { Cookie: cookie })).status, 400);
  assert.equal((await request("/_coord/session", "DELETE", {}, auth)).status, 200);
  assert.equal((await request("/_coord/session", "GET", undefined, { Cookie: cookie })).status, 401);
  assert.equal(woken, 0);
});
