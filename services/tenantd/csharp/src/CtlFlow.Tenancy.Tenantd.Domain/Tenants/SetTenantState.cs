using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static async ValueTask<TenantMutationResult> SetTenantState(
        Tenant tenant,
        Revision expectedRevision,
        ResourceState desiredState,
        IReadOnlyList<ResourceState> workspaceStates,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (tenant.Revision != expectedRevision)
        {
            return new TenantMutationResult.RevisionMismatch();
        }

        if (!Enum.IsDefined(desiredState))
        {
            throw new ArgumentException("Tenant state is invalid", nameof(desiredState));
        }

        if (tenant.State == desiredState)
        {
            return new TenantMutationResult.Current(
                await DescribeTenant(tenant, cancellation));
        }

        var hasRetainedWorkspace = workspaceStates.Any(
            state => state != ResourceState.Deleted);
        if (tenant.State == ResourceState.Deleted
            || desiredState == ResourceState.Deleted && hasRetainedWorkspace)
        {
            return new TenantMutationResult.FailedPrecondition();
        }

        tenant.ChangeState(desiredState, audit.OccurredAt);
        var details = await DescribeTenant(tenant, cancellation);
        return new TenantMutationResult.Changed(
            tenant,
            new AuditIntent(
                AuditEventId.Generate(),
                AuditOperation.SetTenantState,
                audit.Attribution,
                new AuditTarget.Tenant(tenant.Id),
                details.State,
                details.Revision,
                audit.Correlation,
                audit.OccurredAt));
    }
}
