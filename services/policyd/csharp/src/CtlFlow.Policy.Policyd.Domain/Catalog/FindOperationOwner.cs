using CtlFlow.Policy.Policyd.Domain.Operations;

namespace CtlFlow.Policy.Policyd.Domain.Catalog;

public static partial class OperationCatalog
{
    public static OperationOwner? FindOperationOwner(
        OperationToken operation) =>
        operation.Value switch
        {
            "tenants.read"
                or "tenants.update_display_name"
                or "workspaces.create"
                or "workspaces.read"
                or "workspaces.update_display_name"
                or "workspaces.suspend"
                or "workspaces.resume"
                or "workspaces.delete" => OperationOwner.Tenantd,
            "apps.create"
                or "apps.read"
                or "apps.set_package_generation" => OperationOwner.Pkgd,
            "configurations.publish"
                or "configurations.read"
                or "secrets.publish"
                or "secrets.read_metadata" => OperationOwner.Configd,
            "placements.declare"
                or "placements.read"
                or "workloads.declare"
                or "workloads.read"
                or "runs.create"
                or "runs.read"
                or "runs.cancel" => OperationOwner.Execd,
            _ => null
        };
}
