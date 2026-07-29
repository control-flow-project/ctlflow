using CtlFlow.Execution.Execd.Domain.Auditing;

namespace CtlFlow.Execution.Execd.Domain.Runs;

public sealed record CreatedRun(
    Run Entity,
    RunRecord Run,
    AuditIntent Audit);
