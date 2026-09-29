import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as queries from "./data/queries.js";
import { compare, userId } from "../../../packages/contracts/src/management.js";
import { onboardingGuide } from '../../../packages/contracts/src/onboarding.js';
import { agentFilters } from '../../../packages/contracts/src/agent-filters.js';
import { failure, failureStatus, success, type Result } from "../../../packages/contracts/src/result.js";
import { actor, agentRecord, type Context } from "./context.js";
import { requestEnrollment, decide, exchange } from "./enrollment.js";
import { acceptInvitation, authenticate, createSession, endSession } from "./sessions.js";
import { agentView, changeAgent, changeGrants, changeMember, changePolicy, createInvitation, revokeInvitation } from "./management.js";
import { agentRooms, agentRoom } from './agent-rooms.js';
import { heartbeat, disconnect } from './activity.js';
import type { reconciler } from "./reconcile.js";
import { serveArtifact } from "./artifacts.js";
import type { Release } from "../../../packages/files/src/release.js";
import { managedRooms, createRoom, roomMembers, changeRoomMember } from './room-management.js';
import { deliverySettings } from './delivery.js';

const COOKIE = "crossfire";
const MAX_BODY = 64 * 1024;
const MAX_OUTPUT = 1024 * 1024;

async function body(request: IncomingMessage): Promise<Result<unknown>> {
  if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") return failure("invalid", "Expected application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) return failure("limit", "Request exceeds 64 KiB");
    chunks.push(Buffer.from(chunk));
  }
  try { return success(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { return failure("invalid", "Invalid JSON"); }
}

function send(response: ServerResponse, result: Result<unknown>): void {
  const serialized = JSON.stringify(result.ok ? result.value ?? null : { error: result.error });
  if (Buffer.byteLength(serialized) > MAX_OUTPUT) {
    send(response, failure("limit", "Response exceeds 1 MiB"));
    return;
  }
  response.writeHead(result.ok ? 200 : failureStatus[result.error.code], {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  response.end(serialized);
}

function cookie(request: IncomingMessage): string {
  const parts = (request.headers.cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(COOKIE + "="));
  if (parts.length !== 1) return "";
  const credential = parts[0]!.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(credential) ? credential : "";
}

export function page<T extends { id: string }>(rows: T[], url: URL): Result<{ items: T[]; next: string | null }> {
  const allowed = new Set(["after", "limit"]);
  if ([...url.searchParams.keys()].some(key => !allowed.has(key)) || [...allowed].some(key => url.searchParams.getAll(key).length > 1)) {
    return failure("invalid", "Invalid pagination parameters");
  }
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 20;
  const after = url.searchParams.get("after") ?? "";
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || after.length > 255) return failure("invalid", "Invalid finite page bounds");
  const selected = rows.filter(row => compare(row.id, after) > 0).sort((left, right) => compare(left.id, right.id));
  const items = selected.slice(0, limit);
  return success({ items, next: selected.length > limit ? items.at(-1)!.id : null });
}

export function httpService(ctx: Context, worker: ReturnType<typeof reconciler>, release: Release) {
  const startedAt = new Date(ctx.now()).toISOString();
  const attempts = new Map<string, { count: number; start: number }>();
  function rate(request: IncomingMessage): boolean {
    const now = ctx.now();
    for (const [key, entry] of attempts) if (entry.start + 60_000 < now) attempts.delete(key);
    const key = request.socket.remoteAddress ?? "unknown";
    const current = attempts.get(key) ?? { count: 0, start: now };
    if (attempts.size >= 1000 && !attempts.has(key)) return false;
    current.count++;
    attempts.set(key, current);
    return current.count <= 60;
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", ctx.config.publicOrigin);
      if (url.origin !== ctx.config.publicOrigin || request.headers.host !== new URL(ctx.config.publicOrigin).host) {
        send(response, failure("forbidden", "Invalid request host")); return;
      }
      const method = request.method ?? "GET";
      const path = url.pathname;
      if (path === '/_coord/setup') {
        if (method !== 'GET' && method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); response.end(); return;
        }
        const owner = url.searchParams.get('owner');
        if (url.searchParams.size !== 1 || !userId(owner)) {
          send(response, failure('invalid', 'Supply one valid owner Matrix ID')); return;
        }
        const guide = Buffer.from(onboardingGuide(ctx.config.publicOrigin, owner, release.manifest));
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': guide.length,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        response.end(method === 'HEAD' ? undefined : guide); return;
      }
      const listQuery = ["/_coord/agents", "/_coord/enrollments", "/_coord/members", "/_coord/invitations", "/_coord/managed-rooms", "/_coord/audit"].includes(path) || /^\/_coord\/(managed-rooms\/[^/]+\/members|agents\/[^/]+\/rooms)$/u.test(path);
      if (url.search && !(method === "GET" && listQuery)) { send(response, failure("invalid", "Unexpected query parameters")); return; }
      if (serveArtifact(release, method, path, response)) return;
      if (path === '/_coord/release' && method === 'GET') {
        send(response, success(release.manifest)); return;
      }
      if (path === "/_coord/health" && method === "GET") {
        send(response, success({ instance: ctx.config.instance, version: release.manifest.version, release: release.manifest.release,
          runtime: 'node ' + process.versions.node, startedAt })); return;
      }
      if (!path.startsWith("/_coord/") || path === "/_coord/install.mjs" || path === "/_coord/client" || path === "/_coord/dm" || path === "/_coord/rooms") {
        send(response, failure("missing", "Route not found")); return;
      }
      const mutation = !["GET", "HEAD"].includes(method);
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== ctx.config.publicOrigin) { send(response, failure("forbidden", "Invalid request origin")); return; }
      const input = mutation ? await body(request) : success(undefined);
      if (!input.ok) { send(response, input); return; }
      if (path === "/_coord/enrollments" && method === "POST") {
        send(response, rate(request) ? requestEnrollment(ctx, input.value) : failure("limit", "Request rate exceeded")); return;
      }
      const enrollment = /^\/_coord\/enrollments\/([a-f0-9-]{36})\/(decision|exchange)$/u.exec(path);
      if (enrollment?.[2] === "exchange" && method === "POST") {
        send(response, rate(request) ? exchange(ctx, enrollment[1]!, input.value) : failure("limit", "Request rate exceeded")); return;
      }
      const invitation = /^\/_coord\/invitations\/([a-f0-9-]{36})(\/accept)?$/u.exec(path);
      if (invitation?.[2] && method === "POST") {
        send(response, rate(request) ? await acceptInvitation(ctx, invitation[1]!, input.value) : failure("limit", "Request rate exceeded")); return;
      }
      const secure = ctx.config.publicOrigin.startsWith("https:") ? "; Secure" : "";
      if (path === "/_coord/session" && method === "POST") {
        if (origin !== ctx.config.publicOrigin || !rate(request)) { send(response, failure("forbidden", "Same-origin human login required")); return; }
        const session = await createSession(ctx, input.value);
        if (!session.ok) { send(response, session); return; }
        response.setHeader("Set-Cookie", COOKIE + "=" + session.value.credential + "; Path=/; HttpOnly; SameSite=Strict" + secure + "; Max-Age=28800");
        send(response, success({ human: session.value.human, csrf: session.value.csrf })); return;
      }
      const agentPath = /^\/_coord\/agents\/([a-f0-9-]{36})(\/grants)?$/u.exec(path);
      const reporting = /^\/_coord\/agents\/([a-f0-9-]{36})\/heartbeat$/u.exec(path);
      const delivery = /^\/_coord\/agents\/([a-f0-9-]{36})\/delivery$/u.exec(path);
      const disconnectPath = /^\/_coord\/agents\/([a-f0-9-]{36})\/disconnect$/u.exec(path);
      const agentRoomsPath = /^\/_coord\/agents\/([a-f0-9-]{36})\/rooms(?:\/([^/]+))?$/u.exec(path);
      const bearer = request.headers.authorization;
      if (((agentPath && !agentPath[2] || delivery) && method === "GET" || reporting && method === 'POST') && bearer?.startsWith("Bearer ")) {
        if (request.headers.cookie) { send(response, failure("invalid", "Do not mix human and agent authentication")); return; }
        const identity = await ctx.native.identify(bearer.slice(7));
        if (!identity.ok) { send(response, identity); return; }
        const agent = queries.agentIdentity(ctx.store, identity.value);
        if (!agent || agent.id !== (reporting ?? delivery ?? agentPath)![1]) { send(response, failure("missing", "Agent not found")); return; }
        if (reporting) { send(response, heartbeat(ctx, agent.id, input.value, release.manifest)); return; }
        if (delivery) { send(response, success(deliverySettings(ctx, agent))); return; }
        const owner = queries.member(ctx.store, agent.owner)!;
        send(response, success({ ...agentView(ctx, agent), ownerStatus: owner.status })); return;
      }
      const csrf = request.headers["x-crossfire-csrf"];
      if (mutation && (origin !== ctx.config.publicOrigin || typeof csrf !== "string")) {
        send(response, failure("forbidden", "Same-origin CSRF-protected mutation required")); return;
      }
      const session = await authenticate(ctx, cookie(request), mutation ? csrf as string : undefined);
      if (!session.ok) { send(response, session); return; }
      const human = session.value.human;
      const managedRoom = /^\/_coord\/managed-rooms\/([^/]+)\/members$/u.exec(path);
      const administrator = session.value.member.role === "administrator";
      let result: Result<unknown> = failure("missing", "Route not found");
      let changed = false;
      if (path === "/_coord/session" && method === "GET") result = success({ human: session.value.member, csrf: session.value.csrf });
      else if (path === "/_coord/session" && method === "DELETE") {
        result = endSession(ctx, cookie(request));
        response.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; SameSite=Strict" + secure + "; Max-Age=0");
      } else if (path === "/_coord/agents" && method === "GET") {
        const filters = agentFilters(url.searchParams);
        if (!filters.ok) result = filters;
        else {
          const pagination = new URL(url);
          pagination.searchParams.delete('status'); pagination.searchParams.delete('listener');
          const agents = queries.agents(ctx.store, human.id, administrator).filter(agent => filters.value.statuses.includes(agent.status))
            .map(agent => agentView(ctx, agent)).filter(agent => filters.value.listener === 'all' || agent.activity.status === filters.value.listener);
          result = page(agents, pagination);
        }
      }
      else if (agentPath && !agentPath[2] && method === "GET") {
        const found = agentRecord(ctx, human, agentPath[1]!);
        if (!found.ok) result = found;
        else {
          const profile = await ctx.native.profileName(found.value.userId);
          const current = agentRecord(ctx, human, agentPath[1]!);
          result = current.ok ? success({ ...agentView(ctx, current.value), nativeName: profile.ok ? profile.value : null }) : current;
        }
      } else if (agentPath && method === "PATCH" && !agentPath[2]) { result = changeAgent(ctx, human, agentPath[1]!, input.value); changed = true; }
      else if (agentPath?.[2] && method === "PUT") { result = await changeGrants(ctx, human, agentPath[1]!, input.value); changed = true; }
      else if (disconnectPath && method === 'POST') result = disconnect(ctx, human, disconnectPath[1]!, input.value);
      else if (agentRoomsPath && method === 'GET') {
        if (agentRoomsPath[2]) result = await agentRoom(ctx, human, agentRoomsPath[1]!, decodeURIComponent(agentRoomsPath[2]));
        else { const rooms = await agentRooms(ctx, human, agentRoomsPath[1]!); result = rooms.ok ? page(rooms.value, url) : rooms; }
      }
      else if (path === "/_coord/enrollments" && method === "GET") result = page(queries.enrollments(ctx.store, human.id, administrator, ctx.now()).map(({ secretHash: _secretHash, ...request }) => request), url);
      else if (/^\/_coord\/enrollments\/[a-f0-9-]{36}$/u.test(path) && method === "GET") {
        const found = queries.enrollment(ctx.store, path.slice("/_coord/enrollments/".length));
        if (!found || found.owner !== human.id && !administrator) result = failure("missing", "Enrollment not found");
        else { const { secretHash: _secret, ...view } = found; result = success(view); }
      }
      else if (enrollment?.[2] === "decision" && method === "POST") { result = decide(ctx, human, enrollment[1]!, input.value); changed = true; }
      else if (path === "/_coord/members" && method === "GET") result = administrator ? page(queries.members(ctx.store), url) : failure("forbidden", "Administrator required");
      else if (path.startsWith("/_coord/members/") && method === "PATCH") { result = changeMember(ctx, human, decodeURIComponent(path.slice("/_coord/members/".length)), input.value); changed = true; }
      else if (path === "/_coord/policy" && method === "GET") result = success(queries.readPolicy(ctx.store));
      else if (path === '/_coord/managed-rooms' && method === 'GET') {
        const rooms = await managedRooms(ctx, human); result = rooms.ok ? page(rooms.value, url) : rooms;
      } else if (path === '/_coord/managed-rooms' && method === 'POST') result = await createRoom(ctx, human, input.value);
      else if (managedRoom && method === 'GET') {
        const members = await roomMembers(ctx, human, decodeURIComponent(managedRoom[1]!)); result = members.ok ? page(members.value, url) : members;
      } else if (managedRoom && method === 'POST') { result = await changeRoomMember(ctx, human, decodeURIComponent(managedRoom[1]!), input.value); changed = true; }
      else if (path === "/_coord/policy" && method === "PATCH") { result = changePolicy(ctx, human, input.value); changed = true; }
      else if (path === "/_coord/invitations" && method === "GET") result = administrator ? page(queries.invitations(ctx.store).map(({ secretHash: _secretHash, claimHash: _claimHash, ...invite }) => invite), url) : failure("forbidden", "Administrator required");
      else if (path === "/_coord/invitations" && method === "POST") result = createInvitation(ctx, human, input.value);
      else if (invitation && !invitation[2] && method === "DELETE") result = revokeInvitation(ctx, human, invitation[1]!);
      else if (path === "/_coord/audit" && method === "GET") {
        const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(before) || before <= 0 || url.searchParams.getAll("before").length > 1 || [...url.searchParams.keys()].some(key => key !== "before")) result = failure("invalid", "Invalid audit cursor");
        else {
          const items = queries.audit(ctx.store, human.id, administrator, before);
          result = success({ items, next: items.length === 100 ? items.at(-1)!.id : null });
        }
      }
      if (!mutation) {
        const current = actor(ctx, human);
        if (!current.ok) result = current;
      }
      send(response, result);
      if (changed && result.ok) worker.wake();
    } catch (error) {
      const full = error !== null && typeof error === "object" && "code" in error && error.code === "SQLITE_FULL";
      if (!response.headersSent) send(response, full ? failure("limit", "Management storage capacity reached") : failure("native", "Service request failed"));
      else response.destroy();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 64;
  return server;
}
