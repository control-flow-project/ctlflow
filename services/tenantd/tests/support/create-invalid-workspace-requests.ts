import type {
  DeepPartial,
  ResolveWorkspaceRequest
} from "../generated/v1/tenantd.js";

export function createInvalidWorkspaceRequests():
readonly DeepPartial<ResolveWorkspaceRequest>[] {
  return [
    {},
    { tenantId: "tenant_active" },
    { workspaceAddress: "alpha" },
    { tenantId: "", workspaceAddress: "alpha" },
    { tenantId: "Tenant_active", workspaceAddress: "alpha" },
    { tenantId: "_tenant", workspaceAddress: "alpha" },
    { tenantId: "a".repeat(65), workspaceAddress: "alpha" },
    { tenantId: "tenant_active", workspaceAddress: "" },
    { tenantId: "tenant_active", workspaceAddress: "Alpha" },
    { tenantId: "tenant_active", workspaceAddress: "al/pha" },
    { tenantId: "tenant_active", workspaceAddress: "." },
    { tenantId: "tenant_active", workspaceAddress: ".." },
    { tenantId: "tenant_active", workspaceAddress: "%61lpha" },
    { tenantId: "tenant_active", workspaceAddress: "_alpha" },
    { tenantId: "tenant_active", workspaceAddress: "a".repeat(64) }
  ];
}
