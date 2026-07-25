using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record LifecycleOwnerCallers(
    KubernetesServiceAccountSubject Identity,
    KubernetesServiceAccountSubject Configuration,
    KubernetesServiceAccountSubject Execution,
    KubernetesServiceAccountSubject Packages)
{
    internal IReadOnlySet<KubernetesServiceAccountSubject> All { get; } =
        new HashSet<KubernetesServiceAccountSubject>
        {
            Identity,
            Configuration,
            Execution,
            Packages
        };

    internal LifecycleStepKey ResolveStepKey(
        KubernetesServiceAccountSubject caller)
    {
        if (caller == Identity)
        {
            return LifecycleStepKey.Identity;
        }

        if (caller == Configuration)
        {
            return LifecycleStepKey.Configuration;
        }

        if (caller == Execution)
        {
            return LifecycleStepKey.Execution;
        }

        if (caller == Packages)
        {
            return LifecycleStepKey.Packages;
        }

        throw new InvalidOperationException(
            "Lifecycle owner caller is not admitted");
    }
}
