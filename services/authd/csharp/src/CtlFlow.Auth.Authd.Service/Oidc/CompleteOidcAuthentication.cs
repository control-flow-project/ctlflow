using CtlFlow.Auth.Authd.Domain.Oidc;
using CtlFlow.Auth.Authd.Domain.State;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Telemetry;

namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcProtocol
{
    internal static async Task<ProviderSubject>
        CompleteOidcAuthentication(
            HttpClient egressClient,
            AuthdTelemetry telemetry,
            ProviderRegistration provider,
            Uri callbackUri,
            AuthenticationAttempt attempt,
            string code,
            CancellationToken cancellation)
    {
        var tokens = await ExchangeAuthorizationCode(
            egressClient,
            telemetry,
            provider,
            callbackUri,
            code,
            attempt.Verifier,
            cancellation);
        var tokenSubject = ValidateIdToken(
            provider,
            tokens,
            attempt.CreatedAt,
            DateTimeOffset.UtcNow);
        var userInfoSubject = await ReadUserInfo(
            egressClient,
            telemetry,
            provider,
            tokens.AccessToken,
            cancellation);
        if (tokenSubject != userInfoSubject)
        {
            throw new OidcRejectedException();
        }
        return tokenSubject;
    }
}
