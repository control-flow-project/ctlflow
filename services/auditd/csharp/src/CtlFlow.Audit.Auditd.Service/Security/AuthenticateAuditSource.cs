using CtlFlow.Audit.Auditd.Service.Security.Tokens;
using Grpc.Core;
using static CtlFlow.Audit.Auditd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Audit.Auditd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Audit.Auditd.Service.Security;

internal static partial class AuditSourceAuthentication
{
    internal static async ValueTask<AuditSourceIdentity>
        AuthenticateAuditSource(
            Metadata headers,
            TokenValidationSettings settings,
            VerificationKeys keys,
            AuditSourceMappings mappings,
            DateTimeOffset currentTime,
            CancellationToken cancellation)
    {
        var token = ReadBearerToken(
            headers,
            "authorization",
            required: true)
            ?? throw new TokenValidationException();
        var subject = await ValidateWorkloadToken(
            token,
            settings,
            keys,
            currentTime,
            cancellation);
        return new AuditSourceIdentity(
            mappings.Resolve(subject),
            subject);
    }
}
