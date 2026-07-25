import { createWorkspaceBody } from "./create-workspace-body.js";

export function createMaximumWorkspaceBody(
  tenantId: string
): Record<string, unknown> {
  const body = createWorkspaceBody(
    tenantId,
    "d".repeat(200),
    "w".repeat(63));
  const spec = body["spec"] as Record<string, unknown>;
  spec["initialMemberships"] = Array.from(
    { length: 256 },
    (_value, index) => ({
      userId: index === 0
        ? "u".repeat(64)
        : `usr_${String(index)}`,
      standing: index % 2 === 0 ? "admin" : "member"
    }));
  spec["baselinePackages"] = Array.from(
    { length: 64 },
    (_value, index) => ({
      packageId: index === 0
        ? "p".repeat(64)
        : `pkg_${String(index)}`,
      packageVersion: "v".repeat(128)
    }));
  return body;
}
