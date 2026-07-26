using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Runs;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;
using IdentityInvocations =
    CtlFlow.Identity.Identityd.Db.Invocations.Invocations;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<IssueInvocationResponse>
        IssueRunInvocation(
            IssueRunInvocationRequest request,
            ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        await AuthenticateIdentityRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            _settings.IssueRunInvocationCallers,
            requireInvocation: false,
            now,
            context.CancellationToken);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        WorkspaceId? workspaceId = request.HasWorkspaceId
            ? await WorkspaceId.Parse(
                request.WorkspaceId,
                context.CancellationToken)
            : null;
        var principalId = await PrincipalId.Parse(
            request.PrincipalId,
            context.CancellationToken);
        var target = new IdentityTarget(
            tenantId,
            workspaceId);
        var result = await IdentityInvocations.CreateRunInvocation(
            _identityDatabase,
            principalId,
            target,
            RunId.Parse(request.RunId),
            UtcInstant.FromClock(now),
            _settings.Signing.Lifetime,
            context.CancellationToken);
        return await CreateIssueInvocationResponse(
            result,
            context.CancellationToken);
    }
}
