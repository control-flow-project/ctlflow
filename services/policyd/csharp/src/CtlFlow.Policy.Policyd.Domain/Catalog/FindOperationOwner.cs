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
            "tenant_memberships.add"
                or "tenant_memberships.remove"
                or "tenant_memberships.read"
                or "workspace_memberships.add"
                or "workspace_memberships.remove"
                or "workspace_memberships.read"
                or "groups.create"
                or "groups.delete"
                or "groups.read"
                or "group_memberships.add"
                or "group_memberships.remove"
                or "group_memberships.read"
                or "virtual_principals.create"
                or "virtual_principals.read"
                or "virtual_principals.set_enabled"
                or "external_identity_links.create"
                or "external_identity_links.delete"
                or "external_identity_links.read"
                or "login_providers.create"
                or "login_providers.read"
                or "login_providers.update"
                or "login_providers.set_state"
                or "workspace_login_provider_admissions.set"
                or "workspace_login_provider_admissions.read" =>
                    OperationOwner.Identityd,
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
