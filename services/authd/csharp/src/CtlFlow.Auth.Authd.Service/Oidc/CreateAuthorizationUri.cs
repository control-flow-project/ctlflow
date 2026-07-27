using CtlFlow.Auth.Authd.Domain.Oidc;
using CtlFlow.Auth.Authd.Service.Configuration;
using static CtlFlow.Auth.Authd.Service.Oidc.OidcEncoding;

namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcAuthorization
{
    internal static Uri CreateAuthorizationUri(
        ProviderRegistration provider,
        Uri callbackUri,
        string stateHandle,
        PkceVerifier verifier)
    {
        var query = string.Join(
            "&",
            $"response_type={EncodeFormValue("code")}",
            $"client_id={EncodeFormValue(provider.ClientId)}",
            $"redirect_uri={EncodeFormValue(callbackUri.AbsoluteUri)}",
            $"scope={EncodeFormValue("openid")}",
            $"state={EncodeFormValue(stateHandle)}",
            $"code_challenge={EncodeFormValue(verifier.CreateChallenge())}",
            $"code_challenge_method={EncodeFormValue("S256")}");
        var value =
            $"{provider.AuthorizationEndpoint.OriginalString}?{query}";
        if (value.Length > 4_096
            || !Uri.TryCreate(value, UriKind.Absolute, out var result))
        {
            throw new InvalidDataException(
                "Authorization redirect is invalid");
        }

        return result;
    }
}
