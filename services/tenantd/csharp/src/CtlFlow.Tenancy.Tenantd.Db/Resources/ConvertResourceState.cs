using CtlFlow.Tenancy.Tenantd.Domain.Resources;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourceStates
{
    internal static int ToStorage(ResourceState state) =>
        state switch
        {
            (ResourceState)0 => 0,
            ResourceState.Active => 1,
            ResourceState.Suspended => 2,
            ResourceState.Deleted => 3,
            _ => throw new InvalidOperationException("Resource state is invalid")
        };

    internal static ResourceState FromStorage(int state) =>
        state switch
        {
            1 => ResourceState.Active,
            2 => ResourceState.Suspended,
            3 => ResourceState.Deleted,
            _ => throw new InvalidOperationException(
                "Stored resource state is invalid")
        };
}
