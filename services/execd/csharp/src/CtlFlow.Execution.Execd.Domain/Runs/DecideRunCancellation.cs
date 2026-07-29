using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public static partial class Runs
{
    public static async ValueTask<RunCancellationDecision>
        DecideRunCancellation(
            Run entity,
            RunRecord current,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (current.Phase is RunPhase.Cancelling
            or RunPhase.Cancelled)
        {
            return new RunCancellationDecision.Current(current);
        }

        if (current.Phase is RunPhase.Succeeded
            or RunPhase.Failed)
        {
            throw new ExecutionException(
                ExecutionError.FailedPrecondition,
                "A completed Run cannot be cancelled");
        }

        await RequestRunCancellation(
            entity,
            audit.OccurredAt,
            cancellation);
        var changed = current with
        {
            Phase = RunPhase.Cancelling,
            Reason = RunReason.CancelRequested,
            Revision = current.Revision.Next(),
            UpdatedAt = audit.OccurredAt
        };
        var intent = await ExecutionAudits.CreateRunAudit(
            changed,
            RunAuditAction.CancellationRequested,
            audit,
            cancellation);
        return new RunCancellationDecision.Changed(
            entity,
            changed,
            intent);
    }
}
