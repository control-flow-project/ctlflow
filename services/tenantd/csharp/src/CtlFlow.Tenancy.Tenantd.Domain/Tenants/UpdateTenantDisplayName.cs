using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static async ValueTask<TenantMutationResult> UpdateTenantDisplayName(
        Tenant tenant,
        Revision expectedRevision,
        DisplayName displayName,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (tenant.Revision != expectedRevision)
        {
            return new TenantMutationResult.RevisionMismatch();
        }

        if (tenant.State == ResourceState.Deleted)
        {
            return new TenantMutationResult.FailedPrecondition();
        }

        if (tenant.DisplayName == displayName)
        {
            return new TenantMutationResult.Current(
                await DescribeTenant(tenant, cancellation));
        }

        tenant.ChangeDisplayName(displayName, audit.OccurredAt);
        var details = await DescribeTenant(tenant, cancellation);
        return new TenantMutationResult.Changed(
            tenant,
            new AuditIntent(
                AuditEventId.Generate(),
                AuditOperation.UpdateTenant,
                audit.Attribution,
                new AuditTarget.Tenant(tenant.Id),
                details.State,
                details.Revision,
                audit.Correlation,
                audit.OccurredAt));
    }
}
