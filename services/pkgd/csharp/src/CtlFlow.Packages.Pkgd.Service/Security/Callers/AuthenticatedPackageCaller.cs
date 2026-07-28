using CtlFlow.Packages.Pkgd.Service.Security.Operators;
using CtlFlow.Packages.Pkgd.Service.Security.Workloads;

namespace CtlFlow.Packages.Pkgd.Service.Security.Callers;

internal abstract record AuthenticatedPackageCaller
{
    private AuthenticatedPackageCaller()
    {
    }

    internal abstract string Value { get; }

    internal sealed record Operator(
        KubernetesOperatorSubject Subject) : AuthenticatedPackageCaller
    {
        internal override string Value => Subject.Value;
    }

    internal sealed record Workload(
        KubernetesServiceAccountSubject Subject) : AuthenticatedPackageCaller
    {
        internal override string Value => Subject.Value;
    }
}
