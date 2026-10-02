import { cleanup } from '@crossfire/test-support/cleanup';
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import { connectRpc } from "./codex-rpc.js";
import { object, string } from "./native-http.js";

const execute = promisify(execFile);

export async function until(check: () => Promise<boolean> | boolean, description: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    assert(Date.now() < deadline, description);
    await delay(100);
  }
}

export async function codexFixture(context: TestContext, hooks: boolean) {
  const binary = process.env.CROSSFIRE_TEST_CODEX ?? "codex";
  const directory = mkdtempSync(join(tmpdir(), "crossfire-codex-"));
  const home = join(directory, "codex-home");
  const workspace = join(directory, "workspace");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(workspace, { mode: 0o700 });
  const socket = join(directory, "native.sock");
  const mux = "crossfire-architecture-" + randomUUID();
  const environment = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TERM: "xterm-256color", RUST_LOG: "error" };
  const hookLog = join(directory, "hooks.jsonl");
  if (hooks) {
    const script = join(directory, "record-hook.mjs");
    writeFileSync(script, `import { appendFileSync } from 'node:fs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
appendFileSync(${JSON.stringify(hookLog)}, input.trim() + '\\n', { mode: 0o600 });
`, { mode: 0o600 });
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const handler = { type: "command", command: quote(process.execPath) + " " + quote(script), timeout: 3 };
    writeFileSync(join(home, "hooks.json"), JSON.stringify({ hooks: {
      SessionStart: [{ hooks: [handler] }], SessionEnd: [{ hooks: [handler] }],
    } }), { mode: 0o600 });
  }
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
  console.log((await execute(binary, ["--version"], { timeout: 10_000 })).stdout.trim());
  const server = spawn(binary, ["app-server", "--listen", "unix://" + socket], {
    cwd: workspace, env: environment, stdio: ["ignore", "ignore", "pipe"], detached: true,
  });
  let errors = "";
  server.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-4096); });
  const stopped = once(server, "close");
  const terminate = (signal: NodeJS.Signals) => {
    if (!server.pid || server.exitCode !== null) return;
    try { process.kill(-server.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  cleanup(context, async () => {
    terminate("SIGTERM");
    const timer = setTimeout(() => terminate("SIGKILL"), 5000);
    try { await stopped; } finally { clearTimeout(timer); }
  });
  await until(() => existsSync(socket) || server.exitCode !== null, "Native server socket not available");
  assert.equal(server.exitCode, null, errors);
  const observer = await connectRpc(socket);
  cleanup(context, observer.close);
  const tmux = (args: string[]) => execute("tmux", ["-L", mux, "-f", "/dev/null", ...args], {
    env: environment, timeout: 10_000, maxBuffer: 128 * 1024,
  });
  await tmux(["new-session", "-d", "-s", "fixture", "-x", "120", "-y", "40", "--",
    binary, "--remote", "unix://" + socket, "--cd", workspace, "--no-alt-screen"]);
  cleanup(context, async () => {
    if (await tmux(["list-sessions"]).catch(() => undefined)) await tmux(["kill-server"]);
  });
  if (hooks) {
    await until(async () => (await tmux(["capture-pane", "-p", "-t", "fixture"])).stdout.includes("2. Trust all and continue"),
      "Native hook trust dialog did not appear");
    await tmux(["send-keys", "-t", "fixture", "2", "Enter"]);
  }
  await until(async () => {
    if (observer.notifications.some(value => value.method === "thread/started")) return true;
    const pane = await tmux(["capture-pane", "-p", "-t", "fixture"]);
    if (/Press [Ee]nter/u.test(pane.stdout)) await tmux(["send-keys", "-t", "fixture", "Enter"]);
    return false;
  }, "Real TUI did not create a native thread");
  const started = observer.notifications.find(value => value.method === "thread/started");
  assert(started);
  const threadId = string(object(started.params.thread).id);
  async function type(text: string): Promise<void> {
    await tmux(["send-keys", "-t", "fixture", "-l", text]);
    await until(async () => (await tmux(["capture-pane", "-p", "-t", "fixture"])).stdout.includes(text), "Native TUI did not render the typed input");
    await tmux(["send-keys", "-t", "fixture", "Enter"]);
  }
  const active = () => tmux(["has-session", "-t", "fixture"]).then(() => true, () => false);
  const recorded = () => existsSync(hookLog) ? readFileSync(hookLog, "utf8").trim().split("\n").map(line => object(JSON.parse(line))) : [];
  return { server, observer, tmux, threadId, type, active, recorded };
}
