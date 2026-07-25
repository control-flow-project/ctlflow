using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.LifecycleResponses;

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
            Lifecycle = MapLifecycleState(found.Resolution.Lifecycle),
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
}
