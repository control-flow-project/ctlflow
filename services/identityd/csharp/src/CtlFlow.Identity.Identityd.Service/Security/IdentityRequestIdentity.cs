using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Service.Security.Workloads;

namespace CtlFlow.Identity.Identityd.Service.Security;

internal sealed record IdentityRequestIdentity(
    KubernetesServiceAccountSubject ImmediateCaller,
    InvocationIdentity? Invocation);
