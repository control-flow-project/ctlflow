import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { request, string } from "./native-http.js";
import { conduitBinary } from './conduit-assets.js';
export { conduitImage } from './conduit-assets.js';

async function listeningPort(pid: number): Promise<number | undefined> {
  const descriptors = await readdir('/proc/' + pid + '/fd');
  const sockets = new Set<string>();
  for (const descriptor of descriptors) {
    try {
      const target = await readlink('/proc/' + pid + '/fd/' + descriptor);
      const socket = /^socket:\[(\d+)\]$/u.exec(target);
      if (socket) sockets.add(socket[1]!);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  const table = await readFile('/proc/' + pid + '/net/tcp', 'utf8');
  const ports = table.trim().split('\n').slice(1).flatMap(row => {
    const columns = row.trim().split(/\s+/u);
    if (columns[3] !== '0A' || !sockets.has(columns[9]!)) return [];
    const address = /^0100007F:([A-F0-9]{4})$/u.exec(columns[1]!);
    return address ? [Number.parseInt(address[1]!, 16)] : [];
  });
  assert(ports.length <= 1, 'Conduit owns exactly one loopback HTTP listener');
  return ports[0];
}

export async function conduitFixture(context: TestContext, options: { jwtSecret?: string } = {}) {
  const started = performance.now();
  const registrationToken = randomUUID();
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".temp/architecture-conduit-"));
  const database = join(directory, "database");
  mkdirSync(database, { mode: 0o700 });
  const config = join(directory, "conduit.toml");
  writeFileSync(config, `[global]
server_name = "architecture.localhost"
database_backend = "rocksdb"
database_path = ${JSON.stringify(database)}
address = "127.0.0.1"
port = 0
allow_federation = false
allow_registration = true
registration_token = "${registrationToken}"
${options.jwtSecret ? "jwt_secret = " + JSON.stringify(options.jwtSecret) : ""}
allow_room_creation = true
allow_encryption = false
allow_check_for_updates = false
trusted_servers = []
log = "warn"
`, { mode: 0o600 });
  const child = spawn(conduitBinary(), [], { env: { ...process.env, CONDUIT_CONFIG: config, TOKIO_WORKER_THREADS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', failure: Error | undefined;
  const append = (bytes: Buffer) => { output = (output + bytes.toString('utf8')).slice(-16000); };
  child.stdout.on('data', append); child.stderr.on('data', append); child.on('error', error => { failure = error; });
  const exited = new Promise<number | null>(resolve => { child.once('close', resolve); });
  cleanup(context, async () => {
    const before = performance.now(); child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { assert.equal(await exited, 0, output); } finally { clearTimeout(deadline); }
    context.diagnostic('Conduit teardown: ' + Math.round(performance.now() - before) + 'ms');
  });
  assert(child.pid !== undefined);
  let base = '';
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (failure) throw failure;
    assert.equal(child.exitCode, null, 'Native Conduit exited before readiness: ' + output);
    try {
      const port = await listeningPort(child.pid);
      if (port === undefined) {
        assert(Date.now() < deadline, 'Conduit must bind its HTTP listener before the deadline');
        await delay(100);
        continue;
      }
      base = 'http://127.0.0.1:' + port;
      const response = await request(base, "GET", "/_matrix/client/versions");
      assert.equal(response.status, 200);
      console.log("Isolated Conduit native transport ready.");
      context.diagnostic('Conduit startup: ' + Math.round(performance.now() - started) + 'ms');
      break;
    } catch (error) {
      if (Date.now() >= deadline) {
        console.error(output);
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
    return { id: string(response.body.user_id), token: string(response.body.access_token), password: input.password };
  }
  return { base, register, registrationToken };
}
