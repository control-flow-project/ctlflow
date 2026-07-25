namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public abstract record ListLifecycleStepsResult
{
    private ListLifecycleStepsResult()
    {
    }

    public sealed record Page(LifecycleStepPage Value)
        : ListLifecycleStepsResult;

    public sealed record ExpiredPageToken : ListLifecycleStepsResult;
}
