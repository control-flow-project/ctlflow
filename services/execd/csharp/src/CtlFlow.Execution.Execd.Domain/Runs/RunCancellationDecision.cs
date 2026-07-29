using CtlFlow.Execution.Execd.Domain.Auditing;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public abstract record RunCancellationDecision
{
    private RunCancellationDecision()
    {
    }

    public sealed record Current(RunRecord Run)
        : RunCancellationDecision;

    public sealed record Changed(
        Run Entity,
        RunRecord Run,
        AuditIntent Audit) : RunCancellationDecision;
}
