import assert from "node:assert/strict";
import type {
  TenancyApiResponse
} from "./request-tenancy-api.js";
import type { StatusDocument } from "./status-document.js";

export function assertKubernetesStatus(
  response: TenancyApiResponse,
  code: number,
  reason: string
): void {
  assert.equal(response.statusCode, code, response.text);
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  const status = response.body as Partial<StatusDocument>;
  assert.equal(status.apiVersion, "v1");
  assert.equal(status.kind, "Status");
  assert.equal(status.status, "Failure");
  assert.equal(status.reason, reason);
  assert.equal(status.code, code);
}
