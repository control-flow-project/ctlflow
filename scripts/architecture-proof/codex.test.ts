import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { connectRpc } from "./codex-rpc.js";
import { object, string } from "./native-http.js";

const execute = promisify(execFile);

async function until(check: () => Promise<boolean> | boolean, description: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    assert(Date.now() < deadline, description);
    await delay(100);
  }
}

test("actual Codex TUI closure with the native app-server surviving", { timeout: 90_000 }, async context => {
  const directory = mkdtempSync(join(process.cwd(), ".temp/architecture-codex-"));
  const home = join(directory, "codex-home");
  const workspace = join(directory, "workspace");
  mkdirSync(home);
  mkdirSync(workspace);
  const socket = join(directory, "native.sock");
  const mux = "crossfire-architecture-" + process.pid;
  const environment = { ...process.env, CODEX_HOME: home, TERM: "xterm-256color", RUST_LOG: "error" };
  writeFileSync(join(home, "config.toml"), `model = "fixture-model"
model_provider = "fixture"
approval_policy = "never"
[model_providers.fixture]
name = "No model calls in lifecycle proof"
base_url = "http://127.0.0.1:1/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
[projects."${workspace}"]
trust_level = "trusted"
`, { mode: 0o600 });
  const version = await execute("codex", ["--version"], { timeout: 10_000 });
  console.log(version.stdout.trim());
  const server = spawn("codex", ["app-server", "--listen", "unix://" + socket], {
    cwd: workspace, env: environment, stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  server.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-4096); });
  const stopped = once(server, "close");
  context.after(async () => { server.kill("SIGTERM"); await stopped; });
  await until(() => existsSync(socket) || server.exitCode !== null, "Native server socket not available");
  assert.equal(server.exitCode, null, errors);
  const observer = await connectRpc(socket);
  context.after(observer.close);
  const tmux = (args: string[]) => execute("tmux", ["-L", mux, "-f", "/dev/null", ...args], {
    env: environment, timeout: 10_000, maxBuffer: 128 * 1024,
  });
  await tmux(["new-session", "-d", "-s", "fixture", "-x", "120", "-y", "40", "--",
    "codex", "--remote", "unix://" + socket, "--cd", workspace, "--no-alt-screen"]);
  context.after(async () => {
    const result = await tmux(["list-sessions"]).catch(() => undefined);
    if (result) await tmux(["kill-server"]);
  });
  await until(async () => {
    if (observer.notifications.some(value => value.method === "thread/started")) return true;
    const pane = await tmux(["capture-pane", "-p", "-t", "fixture"]);
    if (pane.stdout.includes("Press enter") || pane.stdout.includes("Press Enter")) {
      await tmux(["send-keys", "-t", "fixture", "Enter"]);
    }
    return false;
  }, "Real TUI did not create a native thread");
  const started = observer.notifications.find(value => value.method === "thread/started");
  assert(started);
  const threadId = string(object(started.params.thread).id);
  const before = object((await observer.call("thread/read", { threadId, includeTurns: false })).thread);
  assert.equal(before.id, threadId);
  assert.equal(before.canAcceptDirectInput, true);
  const pane = await tmux(["display-message", "-p", "-t", "fixture", "#{pane_pid}"]);
  const tuiPid = Number(pane.stdout.trim());
  assert(Number.isSafeInteger(tuiPid) && tuiPid > 0);
  process.kill(tuiPid, "SIGTERM");
  await until(async () => !(await tmux(["has-session", "-t", "fixture"]).then(() => true, () => false)), "Fixture TUI did not stop");
  assert.equal(server.exitCode, null, "Native server must survive the TUI closure");
  const after = object((await observer.call("thread/read", { threadId, includeTurns: false })).thread);
  assert.equal(after.id, threadId);
  assert.equal(after.canAcceptDirectInput, true);
  console.log("GAP exact TUI availability: direct-input capability remains true after the actual TUI exits.");
  console.log("Lifecycle evidence:", JSON.stringify({
    before: { status: before.status, canAcceptDirectInput: before.canAcceptDirectInput },
    after: { status: after.status, canAcceptDirectInput: after.canAcceptDirectInput },
    nativeServerSurvived: server.exitCode === null,
  }));
});
