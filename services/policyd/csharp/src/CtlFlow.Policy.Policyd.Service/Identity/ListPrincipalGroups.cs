using System.Diagnostics;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Targets;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using Grpc.Core;

namespace CtlFlow.Policy.Policyd.Service.Identity;

internal static partial class IdentityFacts
{
    private const int GroupPageSize = 100;

    internal static async Task<GroupPage> ListPrincipalGroups(
        IdentityService.IdentityServiceClient client,
        IdentitySettings settings,
        PolicydTelemetry telemetry,
        InvocationIdentity invocation,
        PrincipalId principal,
        PolicyTarget target,
        GroupId? after,
        CancellationToken cancellation)
    {
        using var activity = telemetry.StartIdentityCall(
            "ListPrincipalGroups");
        try
        {
            var request = new ListPrincipalGroupsRequest
            {
                PrincipalId = principal.Value,
                TenantId = target.TenantId.Value,
                PageSize = (uint)GroupPageSize
            };
            if (target.WorkspaceId is { } workspace)
            {
                request.WorkspaceId = workspace.Value;
            }
            if (after is { } cursor)
            {
                request.AfterGroupId = cursor.Value;
            }
            var headers = await CreateIdentityMetadata(
                settings,
                invocation.Token,
                activity,
                cancellation);
            var response = await client.ListPrincipalGroupsAsync(
                request,
                headers,
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            var page = ValidateGroupPage(response, after);
            activity?.SetStatus(ActivityStatusCode.Ok);
            return page;
        }
        catch (RpcException exception)
        {
            activity?.SetStatus(ActivityStatusCode.Error);
            throw MapIdentityFailure(exception, cancellation);
        }
        catch (Exception exception) when (
            exception is IOException
                or InvalidDataException
                or InvalidOperationException
                or ArgumentException)
        {
            activity?.SetStatus(ActivityStatusCode.Error);
            throw new IdentityUnavailableException(exception);
        }
    }

    private static GroupPage ValidateGroupPage(
        ListPrincipalGroupsResponse response,
        GroupId? after)
    {
        if (response.GroupIds.Count > GroupPageSize)
        {
            throw new InvalidDataException(
                "Identityd returned an oversized Group page");
        }
        var groups = new List<GroupId>(response.GroupIds.Count);
        var previous = after;
        foreach (var value in response.GroupIds)
        {
            var group = GroupId.Parse(value);
            if (previous is { } cursor
                && string.CompareOrdinal(group.Value, cursor.Value) <= 0)
            {
                throw new InvalidDataException(
                    "Identityd returned a non-advancing Group page");
            }
            groups.Add(group);
            previous = group;
        }
        GroupId? next = null;
        if (response.HasNextAfterGroupId)
        {
            if (groups.Count != GroupPageSize)
            {
                throw new InvalidDataException(
                    "Identityd returned an invalid Group continuation");
            }
            next = GroupId.Parse(response.NextAfterGroupId);
            if (next != groups[^1])
            {
                throw new InvalidDataException(
                    "Identityd returned an invalid Group continuation");
            }
        }
        return new GroupPage(groups.AsReadOnly(), next);
    }
}
