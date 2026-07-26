using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using static CtlFlow.Tenancy.Tenantd.Service.Authorization.TenantAuthorization;
using CtlFlow.Tenancy.Tenantd.Service.Authorization;
using WorkspaceDatabase =
    CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Workspace> CreateWorkspace(
        CreateWorkspaceRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateWorkspaceCreation(context);
        var workspaceId = await WorkspaceId.Parse(
            request.WorkspaceId,
            context.CancellationToken);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var address = await ResourceAddress.Parse(
            request.Address,
            context.CancellationToken);
        var displayName = await DisplayName.Parse(
            request.DisplayName,
            context.CancellationToken);
        await AuthorizeTenantCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            TenantCapability.CreateWorkspace,
            tenantId,
            null,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await WorkspaceDatabase.CreateWorkspace(
            _tenantDatabase,
            workspaceId,
            tenantId,
            address,
            displayName,
            audit,
            context.CancellationToken);
        return await CompleteWorkspaceMutation(
            result,
            context.CancellationToken);
    }
}
