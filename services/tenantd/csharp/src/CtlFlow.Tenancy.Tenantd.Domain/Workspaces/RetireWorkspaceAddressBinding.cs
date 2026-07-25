using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class WorkspaceAddresses
{
    public static ValueTask RetireWorkspaceAddressBinding(
        WorkspaceAddressBinding binding,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!binding.IsActive)
        {
            return ValueTask.CompletedTask;
        }

        binding.IsActive = false;
        binding.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
