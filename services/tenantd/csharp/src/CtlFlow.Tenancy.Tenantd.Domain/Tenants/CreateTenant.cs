using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static async ValueTask<TenantMutationResult> CreateTenant(
        TenantId tenantId,
        ResourceAddress address,
        DisplayName displayName,
        TenantDetails? existingById,
        TenantDetails? existingByAddress,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existingById is not null)
        {
            return existingById.Address == address
                && existingById.DisplayName == displayName
                ? new TenantMutationResult.Current(existingById)
                : new TenantMutationResult.AlreadyExists();
        }

        if (existingByAddress is not null)
        {
            return new TenantMutationResult.AlreadyExists();
        }

        var tenant = new Tenant(
            tenantId,
            address,
            displayName,
            ResourceState.Active,
            Revision.Initial(),
            audit.OccurredAt,
            audit.OccurredAt);
        var details = await DescribeTenant(tenant, cancellation);
        return new TenantMutationResult.Changed(
            tenant,
            new AuditIntent(
                AuditEventId.Generate(),
                AuditOperation.CreateTenant,
                audit.Attribution,
                new AuditTarget.Tenant(tenantId),
                details.State,
                details.Revision,
                audit.Correlation,
                audit.OccurredAt));
    }
}
