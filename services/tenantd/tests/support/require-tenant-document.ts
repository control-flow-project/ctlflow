import assert from "node:assert/strict";
import type {
  TenancyApiResponse
} from "./request-tenancy-api.js";
import type { TenantDocument } from "./tenant-document.js";

export function requireTenantDocument(
  response: TenancyApiResponse
): TenantDocument {
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  const document = response.body as Partial<TenantDocument>;
  assert.equal(document.apiVersion, "tenancy.ctlflow.com/v1alpha1");
  assert.equal(document.kind, "Tenant");
  return document as TenantDocument;
}
