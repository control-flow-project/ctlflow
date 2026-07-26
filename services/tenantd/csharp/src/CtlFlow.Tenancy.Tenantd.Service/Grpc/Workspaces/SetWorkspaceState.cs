using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using CtlFlow.Tenancy.Tenantd.Service.Authorization;
using static CtlFlow.Tenancy.Tenantd.Service.Authorization.TenantAuthorization;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests.TenancyRequests;
using WorkspaceDatabase =
    CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;
using DomainResourceState =
    CtlFlow.Tenancy.Tenantd.Domain.Resources.ResourceState;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    public override async Task<CtlFlow.Tenancy.V1.Workspace> SetWorkspaceState(
        SetWorkspaceStateRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateWorkspaceStateChange(context);
        var workspaceId = await WorkspaceId.Parse(
            request.WorkspaceId,
            context.CancellationToken);
        var expectedRevision = await Revision.Parse(
            request.ExpectedRevision,
            context.CancellationToken);
        var state = await ParseResourceState(
            request.State,
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
            state switch
            {
                DomainResourceState.Active =>
                    TenantCapability.ResumeWorkspace,
                DomainResourceState.Suspended =>
                    TenantCapability.SuspendWorkspace,
                DomainResourceState.Deleted =>
                    TenantCapability.DeleteWorkspace,
                _ => throw new InvalidOperationException(
                    "Workspace state is invalid")
            },
            tenantId,
            workspaceId,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await WorkspaceDatabase.SetWorkspaceState(
            _tenantDatabase,
            workspaceId,
            expectedRevision,
            state,
            audit,
            context.CancellationToken);
        return await CompleteWorkspaceMutation(
            result,
            context.CancellationToken);
    }
}
