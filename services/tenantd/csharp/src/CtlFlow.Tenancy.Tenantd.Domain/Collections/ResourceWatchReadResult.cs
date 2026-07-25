using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public abstract record ResourceWatchReadResult<T>
{
    private ResourceWatchReadResult()
    {
    }

    public sealed record Batch(
        IReadOnlyList<ResourceWatchEvent<T>> Events,
        ResourceEventCursor Current)
        : ResourceWatchReadResult<T>;

    public sealed record InvalidCursor : ResourceWatchReadResult<T>;

    public sealed record ExpiredCursor : ResourceWatchReadResult<T>;
}
