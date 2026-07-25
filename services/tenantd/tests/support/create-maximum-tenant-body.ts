import { createTenantBody } from "./create-tenant-body.js";

export function createMaximumTenantBody(): Record<string, unknown> {
  const body = createTenantBody(
    "d".repeat(200),
    maximumAuthority());
  const spec = body["spec"] as Record<string, unknown>;
  spec["address"] = {
    authority: maximumAuthority(),
    pathPrefix: `/tenants/${"a".repeat(63)}`
  };
  spec["initialAdministrator"] = {
    displayName: "a".repeat(200),
    loginIdentifier: "l".repeat(320),
    identityLink: {
      providerId: "p".repeat(64),
      providerSubject: "s".repeat(512)
    }
  };
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

function maximumAuthority(): string {
  return [
    "a".repeat(63),
    "b".repeat(63),
    "c".repeat(63),
    "d".repeat(61)
  ].join(".");
}
