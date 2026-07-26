using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public sealed record InvocationClaims(
    AccountId SubjectAccountId,
    PrincipalId? VirtualActorId,
    IdentityTarget Target,
    InvocationOrigin Origin,
    InvocationTokenId TokenId,
    UtcInstant IssuedAt,
    UtcInstant ExpiresAt);
