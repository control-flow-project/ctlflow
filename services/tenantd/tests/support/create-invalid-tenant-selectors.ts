import type {
  DeepPartial,
  ResolveTenantRequest
} from "../generated/v1/tenantd.js";

export function createInvalidTenantSelectors():
readonly DeepPartial<ResolveTenantRequest>[] {
  return [
    {},
    {
      tenantId: "tenant_active",
      externalAddress: {
        authority: "tenant.example.com",
        pathPrefix: "/"
      }
    },
    { tenantId: "" },
    { tenantId: "Tenant_active" },
    { tenantId: "_tenant" },
    { tenantId: "a".repeat(65) },
    { externalAddress: { authority: "", pathPrefix: "/" } },
    {
      externalAddress: {
        authority: "Tenant.example.com",
        pathPrefix: "/"
      }
    },
    {
      externalAddress: {
        authority: "https://tenant.example.com",
        pathPrefix: "/"
      }
    },
    {
      externalAddress: {
        authority: "tenant.example.com:443",
        pathPrefix: "/"
      }
    },
    {
      externalAddress: {
        authority: "tenant.example.com.",
        pathPrefix: "/"
      }
    },
    {
      externalAddress: {
        authority: "tenant.example.com",
        pathPrefix: ""
      }
    },
    {
      externalAddress: {
        authority: "tenant.example.com",
        pathPrefix: "/tenants/"
      }
    },
    {
      externalAddress: {
        authority: "tenant.example.com",
        pathPrefix: "/tenants/Atlas"
      }
    },
    {
      externalAddress: {
        authority: "tenant.example.com",
        pathPrefix: "/tenants/atlas/other"
      }
    },
    {
      externalAddress: {
        authority: "tenant.example.com",
        pathPrefix: "/tenants/%61tlas"
      }
    }
  ];
}
