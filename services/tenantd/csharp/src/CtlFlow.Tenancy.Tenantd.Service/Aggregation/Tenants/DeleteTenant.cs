using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Tenants;

internal static partial class TenantRoutes
{
    internal static Task DeleteTenant(HttpContext context) =>
        ChangeTenantLifecycle(context, LifecycleOperationKind.Delete);
}
