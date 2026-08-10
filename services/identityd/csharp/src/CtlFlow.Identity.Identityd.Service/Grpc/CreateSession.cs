using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Service.Security.Sessions;
using CtlFlow.Identity.V1;
using Google.Protobuf;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Auditing.AuditDelivery;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadAuthentication;
using IdentitySessions =
    CtlFlow.Identity.Identityd.Db.Sessions.Sessions;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal sealed partial class IdentityGrpcService
{
    public override async Task<CreateSessionResponse> CreateSession(
        CreateSessionRequest request,
        ServerCallContext context)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await AuthenticateIdentityRequest(
            context.RequestHeaders,
            _tokenAuthorities,
            _settings.CreateSessionCallers,
            requireInvocation: false,
            now,
            context.CancellationToken);
        var tenantId = await TenantId.Parse(
            request.TenantId,
            context.CancellationToken);
        var providerId = await ProviderId.Parse(
            request.ProviderId,
            context.CancellationToken);
        var providerSubject = await ProviderSubject.Parse(
            request.ProviderSubject,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            now,
            context.CancellationToken);
        using var credential = SessionCredential.Generate();
        var result = await IdentitySessions.CreateSession(
            _identityDatabase,
            tenantId,
            providerId,
            providerSubject,
            credential.CreateDigest(),
            _settings.SessionLifetime,
            audit,
            context.CancellationToken);
        if (result is not SessionCreationResult.Created created)
        {
            throw new Security.Tokens.TokenValidationException();
        }

        await RecordAudit(
            _auditClient,
            _settings.Audit,
            _telemetry,
            created.Creation.AuditIntent,
            context.CancellationToken);
        return new CreateSessionResponse
        {
            SessionId = created.Creation.Session.Id.Value,
            SessionCredential = ByteString.CopyFrom(
                credential.ReadForResponse()),
            ExpiresAt = Timestamp.FromDateTimeOffset(
                created.Creation.Session.ExpiresAt.Value)
        };
    }
}
