import { createWorkspaceBody } from "./create-workspace-body.js";

export function createInvalidWorkspaceBodies(
  tenantId: string
): readonly Record<string, unknown>[] {
  const base = createWorkspaceBody(
    tenantId,
    "Invalid",
    "invalid");
  const spec = base["spec"] as Record<string, unknown>;
  const memberships = spec["initialMemberships"] as readonly unknown[];
  const packages = spec["baselinePackages"] as readonly unknown[];
  return [
    { ...base, apiVersion: "v1" },
    { ...base, kind: "Tenant" },
    { ...base, metadata: { name: "wsp_supplied" } },
    { ...base, spec: { ...spec, tenantId: "Tenant" } },
    { ...base, spec: { ...spec, displayName: "" } },
    { ...base, spec: { ...spec, displayName: "d".repeat(201) } },
    { ...base, spec: { ...spec, workspaceAddress: "Upper" } },
    { ...base, spec: { ...spec, workspaceAddress: "w".repeat(64) } },
    {
      ...base,
      spec: {
        ...spec,
        initialMemberships: [memberships[0], memberships[0]]
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        initialMemberships: Array.from(
          { length: 257 },
          (_value, index) => ({
            userId: `usr_${String(index)}`,
            standing: "member"
          }))
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        initialMemberships: [
          { userId: "User", standing: "member" }
        ]
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        initialMemberships: [
          { userId: "usr_valid", standing: "owner" }
        ]
      }
    },
    { ...base, spec: { ...spec, initialMemberships: undefined } },
    {
      ...base,
      spec: {
        ...spec,
        baselinePackages: [packages[0], packages[0]]
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        baselinePackages: Array.from(
          { length: 65 },
          (_value, index) => ({
            packageId: `pkg_${String(index)}`,
            packageVersion: "1"
          }))
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        baselinePackages: [
          { packageId: "Package", packageVersion: "1" }
        ]
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        baselinePackages: [
          { packageId: "pkg_valid", packageVersion: "v".repeat(129) }
        ]
      }
    },
    { ...base, spec: { ...spec, baselinePackages: undefined } }
  ];
}
