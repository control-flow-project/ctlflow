using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using WorkspaceDatabase =
    CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Workspace> CreateWorkspace(
        CreateWorkspaceRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateAdministration(context);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await WorkspaceDatabase.CreateWorkspace(
            _tenantDatabase,
            await WorkspaceId.Parse(
                request.WorkspaceId,
                context.CancellationToken),
            await TenantId.Parse(
                request.TenantId,
                context.CancellationToken),
            await ResourceAddress.Parse(
                request.Address,
                context.CancellationToken),
            await DisplayName.Parse(
                request.DisplayName,
                context.CancellationToken),
            audit,
            context.CancellationToken);
        return await CompleteWorkspaceMutation(
            result,
            context.CancellationToken);
    }
}
