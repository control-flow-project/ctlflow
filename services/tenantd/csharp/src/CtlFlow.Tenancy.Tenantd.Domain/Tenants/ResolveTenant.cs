using CtlFlow.Tenancy.Tenantd.Domain.Resources;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public static partial class Tenants
{
    public static ValueTask<TenantResolutionResult> ResolveTenant(
        TenantDetails? candidate,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult<TenantResolutionResult>(
            candidate is { State: ResourceState.Active }
                ? new TenantResolutionResult.Found(
                    candidate.TenantId,
                    candidate.State,
                    candidate.Revision)
                : new TenantResolutionResult.NotFound());
    }
}
