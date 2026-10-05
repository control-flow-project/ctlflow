import { nativeServer } from './support/native-server.js';
import { value } from './support/application.js';
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { paths, readProfile } from '@ctlflow/crossfire-adapter-filesystem/project';
import { enroll, connect } from "../apps/client/src/enrollment.js";
import { API } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { releaseFixture } from "./release-fixture.js";


test("public documentation and local pairing enroll one native identity without creating conversations", { timeout: 120_000 }, async scope => {
  const release = await releaseFixture(), fixture = await nativeServer(scope, release);
  const { services, origin, native, worker, admin } = fixture;
  const human = { id: admin.member.principal.matrixUserId, token: admin.token };
  const publicReadme = await fetch(origin + "/onboarding/" + release.manifest.release + "/README.md");
  assert.equal(publicReadme.status, 200);
  const documentation = await publicReadme.text();
  assert(!documentation.includes(native.registrationToken));
  assert(!documentation.includes(fixture.application.config.jwtSecret));
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const project = mkdtempSync(join(process.cwd(), ".temp/project-onboarding-"));
  const destination = paths(project, "holmes");
  const requested = value(await enroll(destination, origin, human.id, "holmes", release.manifest)) as { code: string; approvalUrl: string };
  assert(!JSON.stringify(requested).includes("secret"));
  assert.equal((value(await connect(destination, release.manifest)) as { status: string }).status, "pending");
  assert.equal(value(services.directory.agentIds(admin.actor.principalId)).length, 0);
  assert.equal((await fetch(origin + "/api/enrollments/" + requested.approvalUrl.split("/").at(-1) + "/decision", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, decision: "approve", verificationCode: requested.code }),
  })).status, 403);
  const login = await fetch(origin + "/api/sessions", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ nativeAccessToken: human.token }) });
  assert.equal(login.status, 201);
  const session = await login.json() as { data: { csrfSecret: string } };
  const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
  const approved = await fetch(origin + "/api/enrollments/" + requested.approvalUrl.split("/").at(-1) + "/decision", {
    method: "POST", headers: { Origin: origin, Cookie: cookie, "X-Crossfire-CSRF": session.data.csrfSecret, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: 0, decision: "approve", verificationCode: requested.code }),
  });
  assert.equal(approved.status, 202);
  await worker.drain();
  const connected = value(await connect(destination, release.manifest)) as { status: string };
  assert.equal(connected.status, "connected");
  const profile = readProfile(destination.profile);
  assert.equal(profile.workspace, project);
  assert.equal(profile.settings.owner, human.id);
  assert.equal(statSync(destination.profile).mode & 0o777, 0o600);
  assert.equal(statSync(destination.pending).mode & 0o777, 0o600);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: profile.id })), null);
  assert.deepEqual(value(await nativeOk({ base: native.base, token: profile.account.access_token }, "GET", API + "/joined_rooms")).joined_rooms, []);
  assert.equal((await enroll(destination, origin, human.id, "holmes", release.manifest)).ok, false);
  assert.equal((await connect(destination, release.manifest)).ok, true);
  assert.equal(value(services.directory.agentIds(admin.actor.principalId)).length, 1);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })), []);
});
