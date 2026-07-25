import assert from "node:assert/strict";
import type {
  TenancyApiResponse
} from "./request-tenancy-api.js";
import type { WorkspaceDocument } from "./workspace-document.js";

export function requireWorkspaceDocument(
  response: TenancyApiResponse
): WorkspaceDocument {
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  const document = response.body as Partial<WorkspaceDocument>;
  assert.equal(document.apiVersion, "tenancy.ctlflow.com/v1alpha1");
  assert.equal(document.kind, "Workspace");
  return document as WorkspaceDocument;
}
