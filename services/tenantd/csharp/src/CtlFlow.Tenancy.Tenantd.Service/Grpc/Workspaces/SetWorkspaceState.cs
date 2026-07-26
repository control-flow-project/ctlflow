using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests.TenancyRequests;
using WorkspaceDatabase =
    CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Workspace> SetWorkspaceState(
        SetWorkspaceStateRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateAdministration(context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await WorkspaceDatabase.SetWorkspaceState(
            _tenantDatabase,
            await WorkspaceId.Parse(
                request.WorkspaceId,
                context.CancellationToken),
            await Revision.Parse(
                request.ExpectedRevision,
                context.CancellationToken),
            await ParseResourceState(
                request.State,
                context.CancellationToken),
            audit,
            context.CancellationToken);
        return await CompleteWorkspaceMutation(
            result,
            context.CancellationToken);
    }
}
