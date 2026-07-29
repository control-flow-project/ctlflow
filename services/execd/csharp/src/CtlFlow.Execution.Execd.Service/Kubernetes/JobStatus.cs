using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed record JobStatus(
    RunPhase Phase,
    RunReason Reason,
    int AttemptCount,
    UtcInstant? StartedAt,
    UtcInstant? CompletedAt);
