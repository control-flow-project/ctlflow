using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public static partial class TenantAddresses
{
    public static ValueTask RetireTenantAddressBinding(
        TenantAddressBinding binding,
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
