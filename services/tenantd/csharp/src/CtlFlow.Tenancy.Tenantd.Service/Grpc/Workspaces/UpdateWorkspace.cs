using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using CtlFlow.Tenancy.Tenantd.Service.Authorization;
using static CtlFlow.Tenancy.Tenantd.Service.Authorization.TenantAuthorization;
using WorkspaceDatabase =
    CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Workspace> UpdateWorkspace(
        UpdateWorkspaceRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateWorkspaceUpdate(context);
        var workspaceId = await WorkspaceId.Parse(
            request.WorkspaceId,
            context.CancellationToken);
        var expectedRevision = await Revision.Parse(
            request.ExpectedRevision,
            context.CancellationToken);
        var displayName = await DisplayName.Parse(
            request.DisplayName,
            context.CancellationToken);
        var tenantId = await ResolveWorkspaceAuthorizationTenant(
            _tenantDatabase,
            workspaceId,
            context.CancellationToken);
        await AuthorizeTenantCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            TenantCapability.UpdateWorkspaceDisplayName,
            tenantId,
            workspaceId,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await WorkspaceDatabase.UpdateWorkspace(
            _tenantDatabase,
            workspaceId,
            expectedRevision,
            displayName,
            audit,
            context.CancellationToken);
        return await CompleteWorkspaceMutation(
            result,
            context.CancellationToken);
    }
}
