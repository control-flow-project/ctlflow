import { cleanup } from './cleanup.js';
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect } from '@ctlflow/crossfire-adapter-matrix/http';

export async function nativeProvider(context: TestContext, home: string) {
  const requests: unknown[] = [];
  let held: ServerResponse | undefined;
  let holdNext = true;
  let toolNext = false;
  let toolName = 'fixture_probe';
  let toolArguments = '{}';
  function finish(response: ServerResponse, tool = false): void {
    const item = tool
      ? { type: "function_call", id: "fc-probe", call_id: "call-probe", name: toolName, arguments: toolArguments }
      : { type: "message", id: "message-" + requests.length, role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "Fixture complete." }] };
    response.write("event: response.output_item.done\ndata: " + JSON.stringify({ type: "response.output_item.done", output_index: 0, item }) + "\n\n");
    response.end("event: response.completed\ndata: " + JSON.stringify({ type: "response.completed",
      response: { id: "response-" + requests.length, output: [item], status: "completed",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }) + "\n\n");
  }
  const model = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.writeHead(404); response.end("{}"); return;
      }
      requests.push(JSON.parse((await collect(request, 8 * 1024 * 1024)).toString()));
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write("event: response.created\ndata: " + JSON.stringify({ type: "response.created", response: { id: "response-" + requests.length } }) + "\n\n");
      if (holdNext) { holdNext = false; held = response; }
      else { const tool = toolNext; toolNext = false; finish(response, tool); }
    } catch (error) { response.destroy(error instanceof Error ? error : new Error(String(error))); }
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  cleanup(context, () => new Promise<void>(resolve => { model.closeAllConnections(); model.close(() => resolve()); }));
  const address = model.address(); assert(address && typeof address === "object");
  writeFileSync(join(home, "config.toml"), `model = "fixture-model"
model_provider = "fixture"
approval_policy = "never"
[model_providers.fixture]
name = "Local verification fixture"
base_url = "http://127.0.0.1:${address.port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
`, { mode: 0o600 });
  return { requests, held: () => held,
    hold: () => { held = undefined; holdNext = true; },
    finish: () => { assert(held); finish(held); held = undefined; },
    tool: (name = 'fixture_probe', arguments_: unknown = {}) => {
      toolName = name; toolArguments = JSON.stringify(arguments_); holdNext = false; toolNext = true;
    } };
}
