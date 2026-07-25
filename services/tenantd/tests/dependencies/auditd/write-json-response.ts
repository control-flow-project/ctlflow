import type { ServerResponse } from "node:http";

export function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  body?: unknown
): void {
  response.statusCode = statusCode;
  if (body === undefined) {
    response.end();
    return;
  }

  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
