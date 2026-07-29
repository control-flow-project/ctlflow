using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public sealed record RunExecutionSnapshot(
    AdmittedPackageComponent AdmittedPackage,
    ExecutionResources Resources,
    IReadOnlyList<ResolvedConfigTarget> ConfigTargets,
    IReadOnlyList<AdmittedDependency> Dependencies,
    IReadOnlyList<PersistentStorage> Storage,
    long RunDurationSeconds,
    int MaxAttempts);

public sealed record RunRecord(
    RunId Id,
    WorkloadId WorkloadId,
    Revision WorkloadRevision,
    PlacementId PlacementId,
    PlacementTarget Target,
    PrincipalId? ActorPrincipalId,
    RunExecutionSnapshot Execution,
    RunPhase Phase,
    RunReason Reason,
    int AttemptCount,
    Revision Revision,
    UtcInstant CreatedAt,
    UtcInstant? StartedAt,
    UtcInstant UpdatedAt,
    UtcInstant? CompletedAt)
{
    public bool IsTerminal =>
        Phase is RunPhase.Succeeded or RunPhase.Failed or RunPhase.Cancelled;
}
