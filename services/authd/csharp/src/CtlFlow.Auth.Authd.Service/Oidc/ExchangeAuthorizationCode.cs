using System.Net.Http.Headers;
using System.Text;
using CtlFlow.Auth.Authd.Domain.Oidc;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Egress;
using CtlFlow.Auth.Authd.Service.Telemetry;
using static CtlFlow.Auth.Authd.Service.Egress.EgressRequests;
using static CtlFlow.Auth.Authd.Service.Oidc.OidcEncoding;

namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcProtocol
{
    internal static async Task<TokenResponse> ExchangeAuthorizationCode(
        HttpClient egressClient,
        AuthdTelemetry telemetry,
        WorkloadSettings workload,
        ProviderRegistration provider,
        Uri callbackUri,
        string code,
        PkceVerifier verifier,
        CancellationToken cancellation)
    {
        var body = string.Join(
            "&",
            $"grant_type={EncodeFormValue("authorization_code")}",
            $"code={EncodeFormValue(code)}",
            $"redirect_uri={EncodeFormValue(callbackUri.AbsoluteUri)}",
            $"code_verifier={EncodeFormValue(verifier.ReadForTokenRequest())}");
        if (Encoding.UTF8.GetByteCount(body) > 8 * 1024)
        {
            throw new OidcRejectedException();
        }

        using var content = new StringContent(
            body,
            Encoding.UTF8,
            "application/x-www-form-urlencoded");
        content.Headers.ContentType =
            new MediaTypeHeaderValue(
                "application/x-www-form-urlencoded");
        var basicMaterial = string.Join(
            ":",
            EncodeFormValue(provider.ClientId),
            EncodeFormValue(
                provider.ClientSecret.ReadForBasicAuthentication()));
        var basic = Convert.ToBase64String(
            Encoding.ASCII.GetBytes(basicMaterial));
        var response = await SendEgressRequest(
            egressClient,
            telemetry,
            workload,
            provider,
            provider.TokenEndpoint,
            HttpMethod.Post,
            "authd.egress.token",
            content,
            $"Basic {basic}",
            cancellation);
        return ReadTokenResponse(response);
    }
}
