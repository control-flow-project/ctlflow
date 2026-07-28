using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Service.Security.Principals;

namespace CtlFlow.Configuration.Configd.Service.Security.Invocations;

internal sealed record InvocationIdentity(
    PrincipalId SubjectAccount,
    PrincipalId Actor,
    TenantId? TenantId,
    WorkspaceId? WorkspaceId,
    string TokenId,
    InvocationToken Token);
