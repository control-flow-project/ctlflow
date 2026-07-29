using CtlFlow.Execution.Execd.Domain.Auditing;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public abstract record WorkloadDeclarationDecision
{
    private WorkloadDeclarationDecision()
    {
    }

    public sealed record Current(WorkloadRecord Workload)
        : WorkloadDeclarationDecision;

    public sealed record Changed(
        Workload Entity,
        WorkloadRecord Workload,
        AuditIntent Audit,
        bool IsCreate) : WorkloadDeclarationDecision;
}
