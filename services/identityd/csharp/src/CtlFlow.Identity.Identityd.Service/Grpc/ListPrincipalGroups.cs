using CtlFlow.Identity.Identityd.Domain.Collections;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Domain.Invocations.Invocations;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityGrpcErrors;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;
using IdentityGroups = CtlFlow.Identity.Identityd.Db.Groups.Groups;
using IdentityPrincipals = CtlFlow.Identity.Identityd.Db.Principals.Principals;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ListPrincipalGroupsResponse>
        ListPrincipalGroups(
            ListPrincipalGroupsRequest request,
            ServerCallContext context)
    {
        var identity = await AuthenticateIdentityRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            _settings.ListPrincipalGroupsCallers,
            requireInvocation: true,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var invocation = identity.Invocation
            ?? throw new InvalidOperationException(
                "Required invocation identity is absent");
        var principalId = await PrincipalId.Parse(
            request.PrincipalId,
            context.CancellationToken);
        var target = await ParseTarget(
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            context.CancellationToken);
        var pageSize = await PageSize.Parse(
            request.PageSize,
            context.CancellationToken);
        var afterGroupId = request.HasAfterGroupId
            ? await GroupId.Parse(
                request.AfterGroupId,
                context.CancellationToken)
            : null;
        if (!await CanListPrincipalGroups(
                invocation,
                principalId,
                target,
                context.CancellationToken))
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        var actorResult = await IdentityPrincipals.ResolvePrincipal(
            _identityDatabase,
            invocation.Actor,
            target,
            context.CancellationToken);
        if (actorResult is not PrincipalLookupResult.Found actor
            || !await MatchesInvocation(
                invocation,
                actor.Facts,
                context.CancellationToken))
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        if (principalId != invocation.Actor)
        {
            var principalResult =
                await IdentityPrincipals.ResolvePrincipal(
                    _identityDatabase,
                    principalId,
                    target,
                    context.CancellationToken);
            if (principalResult is not PrincipalLookupResult.Found)
            {
                throw CreateExpectedRpcException(StatusCode.NotFound);
            }
        }

        var page = await IdentityGroups.ListPrincipalGroups(
            _identityDatabase,
            principalId,
            target,
            pageSize,
            afterGroupId,
            context.CancellationToken);
        var response = new ListPrincipalGroupsResponse();
        response.GroupIds.Add(page.GroupIds.Select(value => value.Value));
        if (page.NextAfterGroupId is not null)
        {
            response.NextAfterGroupId = page.NextAfterGroupId.Value;
        }

        return response;
    }
}
