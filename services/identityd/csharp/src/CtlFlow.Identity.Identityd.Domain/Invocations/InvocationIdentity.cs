using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public sealed record InvocationIdentity(
    AccountId SubjectAccount,
    PrincipalId Actor,
    IdentityTarget Fence);
