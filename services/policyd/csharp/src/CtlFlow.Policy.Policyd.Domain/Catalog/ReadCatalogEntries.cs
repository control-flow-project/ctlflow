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
