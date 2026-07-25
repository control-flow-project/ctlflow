namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public abstract record LifecycleAcknowledgementResult
{
    private LifecycleAcknowledgementResult()
    {
    }

    public sealed record Accepted(LifecycleAcknowledgement Value)
        : LifecycleAcknowledgementResult;

    public sealed record NotFound : LifecycleAcknowledgementResult;

    public sealed record StaleOperation : LifecycleAcknowledgementResult;

    public sealed record IdempotencyConflict : LifecycleAcknowledgementResult;

    public sealed record RevisionConflict : LifecycleAcknowledgementResult;

    public sealed record StepNotPending : LifecycleAcknowledgementResult;
}
