using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Service.Security.Principals;

namespace CtlFlow.Packages.Pkgd.Service.Security.Invocations;

internal sealed record InvocationIdentity(
    PrincipalId SubjectAccount,
    PrincipalId Actor,
    TenantId? TenantId,
    WorkspaceId? WorkspaceId,
    string TokenId,
    InvocationToken Token);
