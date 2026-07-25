export function createWorkspaceBody(
  tenantId: string,
  displayName: string,
  workspaceAddress: string
): Record<string, unknown> {
  return {
    apiVersion: "tenancy.ctlflow.com/v1alpha1",
    kind: "Workspace",
    metadata: {},
    spec: {
      tenantId,
      displayName,
      workspaceAddress,
      initialMemberships: [
        { userId: "usr_workspace_admin", standing: "admin" }
      ],
      baselinePackages: [
        { packageId: "pkg_workspace", packageVersion: "1.0.0" }
      ]
    }
  };
}
