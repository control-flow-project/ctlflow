using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Identity.Identityd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask AuthenticateEdgedRequest(
        Metadata headers,
        TokenAuthorities authorities,
        DateTimeOffset currentTime,
        CancellationToken cancellation)
    {
        var workloadToken = ReadBearerToken(
            headers,
            "authorization",
            required: true)
            ?? throw new TokenValidationException();
        await ValidateWorkloadToken(
            workloadToken,
            authorities.EdgedWorkloadSettings,
            authorities.WorkloadKeys,
            currentTime,
            cancellation);

        if (ReadBearerToken(
                headers,
                "ctlflow-invocation",
                required: false) is not null)
        {
            throw new TokenValidationException();
        }
    }
}
