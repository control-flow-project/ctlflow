using CtlFlow.Policy.Policyd.Domain.Catalog;
using CtlFlow.Policy.Policyd.Domain.Targets;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;

namespace CtlFlow.Policy.Policyd.Service.Decisions;

internal static partial class AccessDecisions
{
    private static void EnsureInvocationFence(
        InvocationIdentity invocation,
        CatalogRequest request)
    {
        PolicyTarget target = request.Target;
        if (invocation.TenantId is not { } invocationTenant
            || invocationTenant != target.TenantId)
        {
            throw new TargetNotFoundException();
        }

        if (invocation.WorkspaceId is { } invocationWorkspace)
        {
            if (target.WorkspaceId != invocationWorkspace)
            {
                throw new TargetNotFoundException();
            }
        }

        if (request.AccountScope is { } account
            && account != invocation.SubjectAccount)
        {
            throw new TargetNotFoundException();
        }
    }
}
