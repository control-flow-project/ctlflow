using CtlFlow.Policy.Policyd.Domain.Operations;

namespace CtlFlow.Policy.Policyd.Domain.Catalog;

public static partial class OperationCatalog
{
    public static IReadOnlyList<CatalogEntry> ReadCatalogEntries() =>
        Array.AsReadOnly<CatalogEntry>(
        [
            Entry("tenants.read", OperationOwner.Tenantd),
            Entry("tenants.update_display_name", OperationOwner.Tenantd),
            Entry("workspaces.create", OperationOwner.Tenantd),
            Entry("workspaces.read", OperationOwner.Tenantd),
            Entry("workspaces.update_display_name", OperationOwner.Tenantd),
            Entry("workspaces.suspend", OperationOwner.Tenantd),
            Entry("workspaces.resume", OperationOwner.Tenantd),
            Entry("workspaces.delete", OperationOwner.Tenantd),
            Entry("tenant_memberships.add", OperationOwner.Identityd),
            Entry("tenant_memberships.remove", OperationOwner.Identityd),
            Entry("tenant_memberships.read", OperationOwner.Identityd),
            Entry("workspace_memberships.add", OperationOwner.Identityd),
            Entry("workspace_memberships.remove", OperationOwner.Identityd),
            Entry("workspace_memberships.read", OperationOwner.Identityd),
            Entry("groups.create", OperationOwner.Identityd),
            Entry("groups.delete", OperationOwner.Identityd),
            Entry("groups.read", OperationOwner.Identityd),
            Entry("group_memberships.add", OperationOwner.Identityd),
            Entry("group_memberships.remove", OperationOwner.Identityd),
            Entry("group_memberships.read", OperationOwner.Identityd),
            Entry("virtual_principals.create", OperationOwner.Identityd),
            Entry("virtual_principals.read", OperationOwner.Identityd),
            Entry("virtual_principals.set_enabled", OperationOwner.Identityd),
            Entry("external_identity_links.create", OperationOwner.Identityd),
            Entry("external_identity_links.delete", OperationOwner.Identityd),
            Entry("external_identity_links.read", OperationOwner.Identityd),
            Entry("login_providers.create", OperationOwner.Identityd),
            Entry("login_providers.read", OperationOwner.Identityd),
            Entry("login_providers.update", OperationOwner.Identityd),
            Entry("login_providers.set_state", OperationOwner.Identityd),
            Entry(
                "workspace_login_provider_admissions.set",
                OperationOwner.Identityd),
            Entry(
                "workspace_login_provider_admissions.read",
                OperationOwner.Identityd),
            Entry("apps.create", OperationOwner.Pkgd),
            Entry("apps.read", OperationOwner.Pkgd),
            Entry("apps.set_package_generation", OperationOwner.Pkgd),
            Entry("configurations.publish", OperationOwner.Configd),
            Entry("configurations.read", OperationOwner.Configd),
            Entry("secrets.publish", OperationOwner.Configd),
            Entry("secrets.read_metadata", OperationOwner.Configd),
            Entry("placements.declare", OperationOwner.Execd),
            Entry("placements.read", OperationOwner.Execd),
            Entry("workloads.declare", OperationOwner.Execd),
            Entry("workloads.read", OperationOwner.Execd),
            Entry("runs.create", OperationOwner.Execd),
            Entry("runs.read", OperationOwner.Execd),
            Entry("runs.cancel", OperationOwner.Execd)
        ]);

    private static CatalogEntry Entry(
        string operation,
        OperationOwner owner) =>
        new(OperationToken.Parse(operation), owner);
}

public sealed record CatalogEntry(
    OperationToken Operation,
    OperationOwner Owner);
