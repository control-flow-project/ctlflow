using CtlFlow.Policy.Policyd.Domain.Catalog;
using CtlFlow.Policy.Policyd.Service.Security.Workloads;

namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal sealed partial record OwnerCallerSettings(
    KubernetesServiceAccountSubject Tenantd,
    KubernetesServiceAccountSubject Pkgd,
    KubernetesServiceAccountSubject Configd,
    KubernetesServiceAccountSubject Execd,
    KubernetesServiceAccountSubject Identityd)
{
    internal KubernetesServiceAccountSubject GetCaller(
        OperationOwner owner) =>
        owner switch
        {
            OperationOwner.Tenantd => Tenantd,
            OperationOwner.Pkgd => Pkgd,
            OperationOwner.Configd => Configd,
            OperationOwner.Execd => Execd,
            OperationOwner.Identityd => Identityd,
            _ => throw new InvalidOperationException(
                "Operation owner is invalid")
        };
}
