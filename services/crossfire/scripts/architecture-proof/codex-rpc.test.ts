import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { WebSocketServer } from "ws";
import { connectRpc } from "./codex-rpc.js";

test("proof observer closes on malformed or oversized protocol responses", { timeout: 30_000 }, async context => {
  const cases = [
    { name: "invalid JSON", payload: "{", expected: /JSON/ },
    { name: "invalid result", payload: '{"id":1,"result":null}', expected: /native JSON object/ },
    { name: "oversized frame", payload: "x".repeat(1024 * 1024 + 1), expected: /Max payload size exceeded/ },
  ];
  for (const input of cases) {
    await context.test(input.name, async child => {
      const directory = mkdtempSync(join(tmpdir(), "crossfire-rpc-"));
      cleanup(child, () => rmSync(directory, { recursive: true, force: true }));
      const path = join(directory, "rpc.sock");
      const server = createServer();
      const websocket = new WebSocketServer({ server });
      cleanup(child, async () => {
        for (const client of websocket.clients) client.terminate();
        await new Promise<void>(resolve => websocket.close(() => resolve()));
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      });
      websocket.on("connection", client => {
        client.once("message", () => client.send(input.payload));
      });
      server.listen(path);
      await once(server, "listening");
      await assert.rejects(connectRpc(path), input.expected);
    });
  }
});
