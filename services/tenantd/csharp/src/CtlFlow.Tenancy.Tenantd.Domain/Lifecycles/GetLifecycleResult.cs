namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public abstract record GetLifecycleResult
{
    private GetLifecycleResult()
    {
    }

    public sealed record Found(LifecycleFact Fact) : GetLifecycleResult;

    public sealed record NotFound : GetLifecycleResult;
}
