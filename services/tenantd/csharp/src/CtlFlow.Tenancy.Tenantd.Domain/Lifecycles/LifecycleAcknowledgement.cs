namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleAcknowledgement(
    LifecycleStepState StepState,
    LifecycleStepRevision StepRevision,
    LifecycleState Lifecycle,
    long ResourceRevision,
    long ProvisioningGeneration);
