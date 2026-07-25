import { createTenantBody } from "./create-tenant-body.js";

export function createInvalidTenantBodies():
readonly Record<string, unknown>[] {
  const base = createTenantBody("Invalid", "invalid.example.com");
  const spec = base["spec"] as Record<string, unknown>;
  const address = spec["address"] as Record<string, unknown>;
  const administrator =
    spec["initialAdministrator"] as Record<string, unknown>;
  const identityLink =
    administrator["identityLink"] as Record<string, unknown>;
  const packages = spec["baselinePackages"] as readonly unknown[];
  return [
    { ...base, apiVersion: "v1" },
    { ...base, kind: "Workspace" },
    { ...base, metadata: { name: "tnt_supplied" } },
    { ...base, spec: { ...spec, displayName: "" } },
    { ...base, spec: { ...spec, displayName: "d".repeat(201) } },
    {
      ...base,
      spec: { ...spec, address: { ...address, authority: "Upper.example" } }
    },
    {
      ...base,
      spec: { ...spec, address: { ...address, pathPrefix: "/custom" } }
    },
    {
      ...base,
      spec: {
        ...spec,
        initialAdministrator: {
          ...administrator,
          displayName: "a".repeat(201)
        }
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        initialAdministrator: {
          ...administrator,
          loginIdentifier: "l".repeat(321)
        }
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        initialAdministrator: {
          ...administrator,
          identityLink: { ...identityLink, providerId: "Provider" }
        }
      }
    },
    {
      ...base,
      spec: {
        ...spec,
        initialAdministrator: {
          ...administrator,
          identityLink: {
            ...identityLink,
            providerSubject: "s".repeat(513)
          }
        }
      }
    },
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
