using System.Text.Json;
using CtlFlow.Auth.Authd.Domain.Oidc;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Egress;
using CtlFlow.Auth.Authd.Service.Telemetry;
using static CtlFlow.Auth.Authd.Service.Egress.EgressRequests;

namespace CtlFlow.Auth.Authd.Service.Oidc;

internal static partial class OidcProtocol
{
    internal static async Task<ProviderSubject> ReadUserInfo(
        HttpClient egressClient,
        AuthdTelemetry telemetry,
        WorkloadSettings workload,
        ProviderRegistration provider,
        AccessToken accessToken,
        CancellationToken cancellation)
    {
        var response = await SendEgressRequest(
            egressClient,
            telemetry,
            workload,
            provider,
            provider.UserInfoEndpoint,
            HttpMethod.Get,
            "authd.egress.userinfo",
            content: null,
            $"Bearer {accessToken.ReadForUserInfo()}",
            cancellation);
        RequireJsonContentType(response.ContentType);
        try
        {
            var reader = new Utf8JsonReader(response.Body);
            RequireToken(ref reader, JsonTokenType.StartObject);
            var names = new HashSet<string>(StringComparer.Ordinal);
            string? subject = null;
            while (reader.Read()
                && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    throw new OidcRejectedException();
                }
                var name = reader.GetString()!;
                if (!names.Add(name) || !reader.Read())
                {
                    throw new OidcRejectedException();
                }
                if (name == "sub")
                {
                    subject = ReadString(ref reader);
                }
                else
                {
                    reader.Skip();
                }
            }
            if (reader.TokenType != JsonTokenType.EndObject
                || reader.Read()
                || subject is null)
            {
                throw new OidcRejectedException();
            }
            return ProviderSubject.Parse(subject);
        }
        catch (Exception exception) when (
            exception is JsonException
                or ArgumentException
                or InvalidOperationException)
        {
            throw new OidcRejectedException();
        }
    }
}
