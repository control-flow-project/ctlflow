using CtlFlow.Tenancy.Tenantd.Service.Security.Invocations;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

namespace CtlFlow.Tenancy.Tenantd.Service.Security;

internal sealed record TenantRequestIdentity(
    KubernetesServiceAccountSubject ImmediateCaller,
    InvocationIdentity? Invocation);
