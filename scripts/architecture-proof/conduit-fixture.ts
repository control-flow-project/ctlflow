import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import { request, string } from "./native-http.js";

export const conduitImage = "matrixconduit/matrix-conduit@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642";
const execute = promisify(execFile);

async function docker(args: string[]): Promise<string> {
  const result = await execute("docker", args, { encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

export async function conduitFixture(context: TestContext) {
  const name = "crossfire-architecture-" + randomUUID();
  const registrationToken = randomUUID();
  const directory = mkdtempSync(join(process.cwd(), ".temp/architecture-conduit-"));
  const database = join(directory, "database");
  mkdirSync(database, { mode: 0o700 });
  const config = join(directory, "conduit.toml");
  writeFileSync(config, `[global]
server_name = "architecture.localhost"
database_backend = "rocksdb"
database_path = "/var/lib/matrix-conduit"
address = "0.0.0.0"
port = 6167
allow_federation = false
allow_registration = true
registration_token = "${registrationToken}"
allow_room_creation = true
allow_encryption = false
allow_check_for_updates = false
trusted_servers = []
log = "warn"
`, { mode: 0o600 });
  await docker([
    "run", "--detach", "--rm", "--pull=never", "--name", name, "--label", "crossfire.fixture=architecture",
    "--publish", "127.0.0.1::6167",
    "--mount", "type=bind,src=" + config + ",dst=/etc/conduit.toml,readonly",
    "--mount", "type=bind,src=" + database + ",dst=/var/lib/matrix-conduit",
    "--env", "CONDUIT_CONFIG=/etc/conduit.toml", conduitImage,
  ]);
  context.after(async () => { await docker(["stop", "--timeout", "5", name]); });
  const binding = await docker(["port", name, "6167/tcp"]);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const base = "http://" + binding;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await request(base, "GET", "/_matrix/client/versions");
      assert.equal(response.status, 200);
      console.log("Isolated Conduit native transport ready.");
      break;
    } catch (error) {
      if (Date.now() >= deadline) {
        const logs = await execute("docker", ["logs", "--tail", "15", name], { encoding: "utf8", timeout: 10_000 });
        console.error(logs.stdout + logs.stderr);
        throw error;
      }
      await delay(100);
    }
  }

  async function register(username: string) {
    const input = { username, password: randomUUID(), inhibit_login: false };
    let response = await request(base, "POST", "/_matrix/client/v3/register", input);
    for (let attempt = 0; response.status === 401 && attempt < 4; attempt++) {
      const session = string(response.body.session);
      const completed = response.body.completed;
      assert(completed === undefined || Array.isArray(completed));
      const flow = response.body.flows;
      assert(Array.isArray(flow));
      const stages = flow.flatMap(value => {
        assert(value !== null && typeof value === "object" && "stages" in value && Array.isArray(value.stages));
        return value.stages as unknown[];
      });
      const stage = stages.find(value => !(Array.isArray(completed) && completed.includes(value)));
      assert(stage === "m.login.registration_token" || stage === "m.login.dummy", "Unexpected registration challenge");
      response = await request(base, "POST", "/_matrix/client/v3/register", {
        ...input, auth: { type: stage, session, ...(stage === "m.login.registration_token" ? { token: registrationToken } : {}) },
      });
    }
    assert.equal(response.status, 200, "Isolated registration did not finish");
    return { id: string(response.body.user_id), token: string(response.body.access_token) };
  }
  return { base, register };
}
