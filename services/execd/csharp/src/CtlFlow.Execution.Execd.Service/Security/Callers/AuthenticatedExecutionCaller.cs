using CtlFlow.Execution.Execd.Service.Security.Operators;
using CtlFlow.Execution.Execd.Service.Security.Workloads;

namespace CtlFlow.Execution.Execd.Service.Security.Callers;

internal abstract record AuthenticatedExecutionCaller
{
    private AuthenticatedExecutionCaller()
    {
    }

    internal abstract string Value { get; }

    internal sealed record Operator(
        KubernetesOperatorSubject Subject) : AuthenticatedExecutionCaller
    {
        internal override string Value => Subject.Value;
    }

    internal sealed record Workload(
        KubernetesServiceAccountSubject Subject) : AuthenticatedExecutionCaller
    {
        internal override string Value => Subject.Value;
    }
}
