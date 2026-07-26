using CtlFlow.Tenancy.Tenantd.Service.Security.Operators;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

namespace CtlFlow.Tenancy.Tenantd.Service.Security.Callers;

internal abstract record AuthenticatedTenantCaller
{
    private AuthenticatedTenantCaller()
    {
    }

    internal abstract string Value { get; }

    internal sealed record Operator(
        KubernetesOperatorSubject Subject) : AuthenticatedTenantCaller
    {
        internal override string Value => Subject.Value;
    }

    internal sealed record Workload(
        KubernetesServiceAccountSubject Subject) : AuthenticatedTenantCaller
    {
        internal override string Value => Subject.Value;
    }
}
