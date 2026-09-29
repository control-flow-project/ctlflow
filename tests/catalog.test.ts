import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generate } from "../scripts/generate-matrix-api.js";

test("the sole Matrix catalog generator keeps native fields and executes after compilation", () => {
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".temp/catalog-"));
  writeFileSync(join(directory, "messages.yaml"), `servers:
  - url: https://example.org/_matrix/client/v3
paths:
  /rooms/{roomId}/messages:
    get:
      operationId: getRoomEvents
      parameters:
        - name: roomId
          in: path
          required: true
          schema: { type: string }
        - name: from
          in: query
          schema: { type: string }
        - name: dir
          in: query
          required: true
          schema: { type: string, enum: [b, f] }
      responses:
        '200':
          content:
            application/json: { schema: { type: object } }
`);
  const generated = generate(directory);
  assert.equal(generated.operations.length, 1);
  assert.deepEqual(generated.operations[0], { id: "getRoomEvents", command: "get-room-events", method: "GET",
    path: "/_matrix/client/v3/rooms/{roomId}/messages", access: "agent",
    parameters: [{ name: "roomId", location: "path", required: true, type: "string" },
      { name: "from", location: "query", required: false, type: "string" },
      { name: "dir", location: "query", required: true, type: "string", values: ["b", "f"] }],
    body: "none", response: "json" });
  const command = fileURLToPath(new URL("../scripts/generate-matrix-api.js", import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [command, "--source", directory], { stdio: "pipe" }), error => {
    assert(error instanceof Error && "stderr" in error);
    assert.match(String(error.stderr), /--root must/u);
    return true;
  });
  assert.throws(() => execFileSync(process.execPath, [command, "--root", process.cwd(), "--source", directory, "--check"], { stdio: "pipe" }), error => {
    assert(error instanceof Error && "stderr" in error);
    assert.match(String(error.stderr), /differ from the audited official/u);
    return true;
  });
});
