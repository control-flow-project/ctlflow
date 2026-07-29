using DomainTenantId =
    CtlFlow.Execution.Execd.Domain.Identifiers.TenantId;
using DomainWorkspaceId =
    CtlFlow.Execution.Execd.Domain.Identifiers.WorkspaceId;
using SecurityPrincipalId =
    CtlFlow.Execution.Execd.Service.Security.Principals.PrincipalId;

namespace CtlFlow.Execution.Execd.Service.Security.Invocations;

internal sealed record InvocationIdentity(
    SecurityPrincipalId SubjectAccount,
    SecurityPrincipalId Actor,
    DomainTenantId? TenantId,
    DomainWorkspaceId? WorkspaceId,
    string TokenId,
    InvocationToken Token);
