using CtlFlow.Execution.Execd.Domain.Auditing;

namespace CtlFlow.Execution.Execd.Domain.Resources;

public sealed record MutationResult<T>(
    T Record,
    AuditIntent? Audit)
{
    public bool Changed => Audit is not null;
}
