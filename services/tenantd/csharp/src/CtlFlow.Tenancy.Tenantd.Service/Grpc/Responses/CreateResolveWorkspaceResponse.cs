using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using DomainWorkspaceLifecycle = CtlFlow.Tenancy.Tenantd.Domain.Workspaces.WorkspaceLifecycle;
using WireWorkspaceLifecycle = CtlFlow.Tenancy.V1.WorkspaceLifecycle;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class WorkspaceResponses
{
    internal static ValueTask<ResolveWorkspaceResponse> CreateResolveWorkspaceResponse(
        ResolveWorkspaceResult result,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (result is ResolveWorkspaceResult.NotFound)
        {
            throw new RpcException(
                new Status(StatusCode.NotFound, "Workspace was not found"));
        }

        if (result is not ResolveWorkspaceResult.Found found)
        {
            throw new UnreachableException();
        }

        var response = new ResolveWorkspaceResponse
        {
            WorkspaceId = found.Resolution.WorkspaceId.Value,
            Lifecycle = MapLifecycle(found.Resolution.Lifecycle),
            WorkspaceRevision = checked((ulong)found.Resolution.Revision.Value),
            Address = new ResolvedWorkspaceAddress
            {
                BindingGeneration = checked(
                    (ulong)found.Resolution.AddressBindingGeneration.Value)
            },
            CacheExpiresAt = Timestamp.FromDateTimeOffset(
                found.Resolution.CacheExpiry.Value)
        };

        return ValueTask.FromResult(response);
    }

    private static WireWorkspaceLifecycle MapLifecycle(
        DomainWorkspaceLifecycle lifecycle) =>
        lifecycle switch
        {
            DomainWorkspaceLifecycle.Provisioning =>
                WireWorkspaceLifecycle.Provisioning,
            DomainWorkspaceLifecycle.Active =>
                WireWorkspaceLifecycle.Active,
            DomainWorkspaceLifecycle.Suspended =>
                WireWorkspaceLifecycle.Suspended,
            DomainWorkspaceLifecycle.Deleting =>
                WireWorkspaceLifecycle.Deleting,
            DomainWorkspaceLifecycle.Failed =>
                WireWorkspaceLifecycle.Failed,
            DomainWorkspaceLifecycle.Deleted =>
                WireWorkspaceLifecycle.Deleted,
            _ => throw new UnreachableException()
        };
}
