using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using CtlFlow.Identity.Identityd.Service.Security.Sessions;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;
using IdentityInvocations =
    CtlFlow.Identity.Identityd.Db.Invocations.Invocations;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<IssueInvocationResponse> ExchangeSession(
        ExchangeSessionRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        await AuthenticateEdgedRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            now,
            context.CancellationToken);
        using var credential = SessionCredential.Parse(
            request.SessionCredential.Span);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        WorkspaceId? workspaceId = request.HasWorkspaceId
            ? await WorkspaceId.Parse(
                request.WorkspaceId,
                context.CancellationToken)
            : null;
        var target = new IdentityTarget(
            tenantId,
            workspaceId);
        var result = await IdentityInvocations.CreateSessionInvocation(
            _identityDatabase,
            credential.CreateDigest(),
            target,
            UtcInstant.FromClock(now),
            _settings.Signing.Lifetime,
            context.CancellationToken);
        return await CreateIssueInvocationResponse(
            result,
            context.CancellationToken);
    }
}
