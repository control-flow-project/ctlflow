import type {
  IdentitydTestContext
} from "../create-identityd-test-context.js";

export interface IdentityCapability {
  readonly operation: string;
  readonly resourcePath: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
}

export async function allowIdentityCapabilities(
  context: IdentitydTestContext,
  capabilities: readonly IdentityCapability[]
): Promise<void> {
  await context.policyd.replacePolicy({
    roles: [],
    grants: capabilities.map((capability) => ({
      owner: { kind: "kernel" as const, id: "svc_identityd" },
      operation: capability.operation,
      basePath: capability.resourcePath,
      match: "exact" as const,
      subject: { kind: "principal" as const, id: "user:alice" },
      target: {
        tenantId: capability.tenantId,
        ...(capability.workspaceId === undefined
          ? {}
          : { workspaceId: capability.workspaceId })
      }
    }))
  });
}
