using CtlFlow.Policy.Policyd.Domain.Catalog;
using CtlFlow.Policy.Policyd.Service.Security.Workloads;

namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal sealed partial record OwnerCallerSettings
{
    // A caller outside the exact kernel-owner set is a product workload whose
    // authority must be resolved through Execd.
    internal OperationOwner? FindOwner(KubernetesServiceAccountSubject caller)
    {
        if (caller == Tenantd) return OperationOwner.Tenantd;
        if (caller == Pkgd) return OperationOwner.Pkgd;
        if (caller == Configd) return OperationOwner.Configd;
        if (caller == Execd) return OperationOwner.Execd;
        return null;
    }
}
