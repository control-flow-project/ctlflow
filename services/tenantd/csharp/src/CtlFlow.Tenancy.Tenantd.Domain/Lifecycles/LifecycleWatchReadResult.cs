using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public abstract record LifecycleWatchReadResult
{
    private LifecycleWatchReadResult()
    {
    }

    public sealed record Batch(
        IReadOnlyList<LifecycleWorkItem> Items,
        LifecycleDeliveryCursor Current)
        : LifecycleWatchReadResult;

    public sealed record InvalidCursor : LifecycleWatchReadResult;
}
