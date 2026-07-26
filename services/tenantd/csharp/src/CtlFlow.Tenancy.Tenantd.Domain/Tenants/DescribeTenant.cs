namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask<TenantDetails> DescribeTenant(
        Tenant tenant,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new TenantDetails(
            tenant.Id,
            tenant.Address,
            tenant.DisplayName,
            tenant.State,
            tenant.Revision,
            tenant.CreatedAt,
            tenant.UpdatedAt));
    }
}
