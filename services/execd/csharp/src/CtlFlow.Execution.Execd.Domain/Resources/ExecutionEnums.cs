namespace CtlFlow.Execution.Execd.Domain.Resources;

public enum DesiredState
{
    Active = 1,
    Suspended = 2,
    Retired = 3
}

public enum WorkloadMode
{
    Continuous = 1,
    Finite = 2
}

public enum RealizationPhase
{
    Pending = 1,
    Ready = 2,
    Suspended = 3,
    Degraded = 4,
    Retired = 5
}

public enum RealizationReason
{
    None = 1,
    PlacementNotReady = 2,
    BindingUnavailable = 3,
    KubernetesUnavailable = 4,
    RealizationRejected = 5,
    OwnershipConflict = 6,
    StorageUnavailable = 7,
    ExecutionUnready = 8
}

public enum RunPhase
{
    Pending = 1,
    Starting = 2,
    Running = 3,
    Cancelling = 4,
    Succeeded = 5,
    Failed = 6,
    Cancelled = 7
}

public enum RunReason
{
    None = 1,
    CancelRequested = 2,
    PlacementInactive = 3,
    WorkloadInactive = 4,
    BindingUnavailable = 5,
    InvocationNotAdmitted = 6,
    InvocationUnavailable = 7,
    KubernetesUnavailable = 8,
    RealizationRejected = 9,
    OwnershipConflict = 10,
    ExecutionFailed = 11,
    DurationExceeded = 12
}

public enum DataKind
{
    Configuration = 1,
    Secret = 2
}

public enum InterfaceProtocol
{
    Http = 1,
    Grpc = 2
}

public enum DependencyBindingPhase
{
    Pending = 1,
    Ready = 2,
    Rejected = 3
}
