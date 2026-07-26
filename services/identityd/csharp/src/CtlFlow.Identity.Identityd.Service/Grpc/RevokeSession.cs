using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Service.Security.Sessions;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;
using IdentitySessions =
    CtlFlow.Identity.Identityd.Db.Sessions.Sessions;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<RevokeSessionResponse> RevokeSession(
        RevokeSessionRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateIdentityRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            _settings.RevokeSessionCallers,
            requireInvocation: false,
            now,
            context.CancellationToken);
        using var credential = SessionCredential.Parse(
            request.SessionCredential.Span);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        var result = await IdentitySessions.RevokeSession(
            _identityDatabase,
            credential.CreateDigest(),
            audit,
            context.CancellationToken);
        if (result is not SessionRevocationResult.Found found)
        {
            throw new Security.Tokens.TokenValidationException();
        }

        if (found.Revocation.AuditIntent is { } auditIntent)
        {
            await RecordAudit(
                _auditClient,
                _settings.Audit,
                _telemetry,
                auditIntent,
                context.CancellationToken);
        }

        return new RevokeSessionResponse();
    }
}
