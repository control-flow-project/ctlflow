export function createTenantBody(
  displayName: string,
  authority: string
): Record<string, unknown> {
  return {
    apiVersion: "tenancy.ctlflow.com/v1alpha1",
    kind: "Tenant",
    metadata: {},
    spec: {
      displayName,
      address: {
        authority,
        pathPrefix: "/"
      },
      initialAdministrator: {
        displayName: "Ada Lovelace",
        loginIdentifier: "ada@example.com",
        identityLink: {
          providerId: "provider_primary",
          providerSubject: "ada-1"
        }
      },
      baselinePackages: [
        {
          packageId: "pkg_chat",
          packageVersion: "1.0.0"
        }
      ]
    }
  };
}
