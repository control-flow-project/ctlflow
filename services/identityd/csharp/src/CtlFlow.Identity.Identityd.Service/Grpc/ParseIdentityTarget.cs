using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityRequests
{
    internal static async ValueTask<IdentityTarget> ParseIdentityTarget(
        string tenantId,
        string? workspaceId,
        CancellationToken cancellation) => new(
        await TenantId.Parse(tenantId, cancellation),
        workspaceId is null
            ? null
            : await WorkspaceId.Parse(workspaceId, cancellation));
}
