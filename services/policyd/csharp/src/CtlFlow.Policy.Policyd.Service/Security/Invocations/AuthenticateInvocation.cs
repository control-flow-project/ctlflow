using Grpc.Core;
using CtlFlow.Policy.Policyd.Service.Security.Tokens;
using static CtlFlow.Policy.Policyd.Service.Security.Tokens.RequestTokens;

namespace CtlFlow.Policy.Policyd.Service.Security.Invocations;

internal static partial class InvocationTokens
{
    internal static async ValueTask<InvocationIdentity>
        AuthenticateInvocation(
            Metadata headers,
            TokenAuthorities authorities,
            DateTimeOffset currentTime,
            CancellationToken cancellation)
    {
        var token = ReadBearerToken(
            headers,
            "ctlflow-invocation",
            required: true)
            ?? throw new TokenValidationException();
        return await ValidateInvocationToken(
            token,
            authorities.InvocationSettings,
            authorities.InvocationKeys,
            currentTime,
            cancellation);
    }
}
