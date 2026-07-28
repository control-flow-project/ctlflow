using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Service.Security.Invocations;

internal sealed record InvocationIdentity(
    PrincipalId SubjectAccount,
    PrincipalId Actor,
    TenantId? TenantId,
    WorkspaceId? WorkspaceId,
    InvocationToken Token);
