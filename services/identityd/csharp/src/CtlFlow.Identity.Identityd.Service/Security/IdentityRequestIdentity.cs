using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Service.Security.Workloads;
using CtlFlow.Identity.Identityd.Service.Security.Invocations;

namespace CtlFlow.Identity.Identityd.Service.Security;

internal sealed record IdentityRequestIdentity(
    KubernetesServiceAccountSubject ImmediateCaller,
    InvocationIdentity? Invocation,
    InvocationToken? InvocationToken);
