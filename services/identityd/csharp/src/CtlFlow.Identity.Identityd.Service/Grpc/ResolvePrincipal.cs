using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Db.Principals.Principals;
using static CtlFlow.Identity.Identityd.Domain.Invocations.Invocations;
using static CtlFlow.Identity.Identityd.Service.Grpc.IdentityGrpcErrors;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<ResolvePrincipalResponse> ResolvePrincipal(
        ResolvePrincipalRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateIdentityRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            _settings.ResolvePrincipalCallers,
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
        if (!await CanResolvePrincipal(
                invocation,
                principalId,
                target,
                context.CancellationToken))
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        var result = await Db.Principals.Principals.ResolvePrincipal(
            _identityDatabase,
            principalId,
            target,
            context.CancellationToken);
        if (result is not PrincipalLookupResult.Found found
            || !await MatchesInvocation(
                invocation,
                found.Facts,
                context.CancellationToken))
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        return CreatePrincipalResponse(found.Facts);
    }

    private static async ValueTask<IdentityTarget> ParseTarget(
        string tenantId,
        string? workspaceId,
        CancellationToken cancellation)
    {
        var tenant = await TenantId.Parse(tenantId, cancellation);
        var workspace = workspaceId is null
            ? null
            : await WorkspaceId.Parse(workspaceId, cancellation);
        return new IdentityTarget(tenant, workspace);
    }

    private static ResolvePrincipalResponse CreatePrincipalResponse(
        PrincipalFacts facts) =>
        new()
        {
            PrincipalId = facts.PrincipalId.Value,
            PrincipalKind = facts.PrincipalKind switch
            {
                Domain.Principals.PrincipalKind.Human =>
                    V1.PrincipalKind.Human,
                Domain.Principals.PrincipalKind.Service =>
                    V1.PrincipalKind.Service,
                Domain.Principals.PrincipalKind.Virtual =>
                    V1.PrincipalKind.Virtual,
                _ => throw new InvalidOperationException(
                    "Unknown principal kind")
            },
            PrincipalEnabled = facts.PrincipalEnabled,
            PrincipalRevision = checked(
                (ulong)facts.PrincipalRevision.Value),
            SubjectAccountId = facts.SubjectAccountId.Value,
            SubjectAccountEnabled = facts.SubjectAccountEnabled,
            SubjectAccountRevision = checked(
                (ulong)facts.SubjectAccountRevision.Value),
            MembershipRevision = checked(
                (ulong)facts.MembershipRevision.Value)
        };
}
