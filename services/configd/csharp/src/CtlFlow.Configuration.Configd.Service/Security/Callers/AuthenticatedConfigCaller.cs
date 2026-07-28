using CtlFlow.Configuration.Configd.Service.Security.Operators;
using CtlFlow.Configuration.Configd.Service.Security.Workloads;

namespace CtlFlow.Configuration.Configd.Service.Security.Callers;

internal abstract record AuthenticatedConfigCaller
{
    private AuthenticatedConfigCaller()
    {
    }

    internal abstract string Value { get; }

    internal sealed record Operator(
        KubernetesOperatorSubject Subject) : AuthenticatedConfigCaller
    {
        internal override string Value => Subject.Value;
    }

    internal sealed record Workload(
        KubernetesServiceAccountSubject Subject) : AuthenticatedConfigCaller
    {
        internal override string Value => Subject.Value;
    }
}
