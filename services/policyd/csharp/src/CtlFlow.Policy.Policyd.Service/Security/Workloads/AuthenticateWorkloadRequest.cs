using Grpc.Core;
using CtlFlow.Policy.Policyd.Service.Security.Tokens;
using static CtlFlow.Policy.Policyd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Policy.Policyd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Policy.Policyd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask<KubernetesServiceAccountSubject>
        AuthenticateWorkloadRequest(
            Metadata headers,
            TokenAuthorities authorities,
            DateTimeOffset currentTime,
            CancellationToken cancellation)
    {
        var token = ReadBearerToken(
            headers,
            "authorization",
            required: true)
            ?? throw new TokenValidationException();
        return await ValidateWorkloadToken(
            token,
            authorities.WorkloadSettings,
            authorities.WorkloadKeys,
            currentTime,
            cancellation);
    }
}
