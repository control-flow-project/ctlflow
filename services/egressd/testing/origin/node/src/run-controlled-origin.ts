import {
  readFile
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import {
  handleOriginControl
} from "./handle-origin-control.js";
import {
  handleOriginRequest
} from "./handle-origin-request.js";
import type {
  OriginState
} from "./origin-state.js";

const servicePort = readPort("CTLFLOW_TEST_ORIGIN_SERVICE_PORT");
const controlPort = readPort("CTLFLOW_TEST_ORIGIN_CONTROL_PORT");
const state: OriginState = {
  evidence: [],
  available: true
};
const origin = https.createServer(
  {
    cert: await readFile(requireEnvironment(
      "CTLFLOW_TEST_ORIGIN_CERTIFICATE_PATH")),
    key: await readFile(requireEnvironment(
      "CTLFLOW_TEST_ORIGIN_PRIVATE_KEY_PATH"))
  },
  (request, response) => {
    void handleOriginRequest(request, response, state)
      .catch(() => {
        if (!response.headersSent) {
          response.writeHead(500);
        }
        response.end();
      });
  });
const control = http.createServer((request, response) => {
  void handleOriginControl(request, response, state)
    .catch(() => {
      response.writeHead(400);
      response.end();
    });
});
await listen(origin, servicePort);
await listen(control, controlPort);
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

function listen(
  server: http.Server | https.Server,
  port: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
}

function readPort(name: string): number {
  const value = Number(requireEnvironment(name));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function shutdown(): void {
  origin.close();
  control.close();
}
