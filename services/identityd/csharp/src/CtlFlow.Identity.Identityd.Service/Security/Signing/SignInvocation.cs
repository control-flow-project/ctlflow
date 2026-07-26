using System.Buffers;
using System.Text;
using System.Text.Json;
using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;

namespace CtlFlow.Identity.Identityd.Service.Security.Signing;

internal static partial class InvocationSigning
{
    internal static ValueTask<InvocationJwt> SignInvocation(
        InvocationSigningKey signingKey,
        TokenValidationSettings tokenSettings,
        InvocationClaims claims,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var header = WriteHeader(signingKey.KeyId.Value);
        var payload = WritePayload(tokenSettings, claims);
        var encodedHeader = EncodeBase64Url(header);
        var encodedPayload = EncodeBase64Url(payload);
        var unsignedToken = $"{encodedHeader}.{encodedPayload}";
        var signature = signingKey.Sign(
            Encoding.ASCII.GetBytes(unsignedToken));
        return ValueTask.FromResult(new InvocationJwt(
            $"{unsignedToken}.{EncodeBase64Url(signature)}"));
    }

    private static byte[] WriteHeader(string keyId)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using var writer = new Utf8JsonWriter(buffer);
        writer.WriteStartObject();
        writer.WriteString("alg", "RS256");
        writer.WriteString("kid", keyId);
        writer.WriteString("typ", "JWT");
        writer.WriteEndObject();
        writer.Flush();
        return buffer.WrittenSpan.ToArray();
    }

    private static byte[] WritePayload(
        TokenValidationSettings settings,
        InvocationClaims claims)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using var writer = new Utf8JsonWriter(buffer);
        writer.WriteStartObject();
        writer.WriteString("iss", settings.Issuer);
        writer.WriteString("aud", settings.Audience);
        writer.WriteString("sub", claims.SubjectAccountId.Value);
        if (claims.VirtualActorId is { } actor)
        {
            writer.WriteStartObject("act");
            writer.WriteString("sub", actor.Value);
            writer.WriteEndObject();
        }

        writer.WriteString("tenant_id", claims.Target.TenantId.Value);
        if (claims.Target.WorkspaceId is { } workspaceId)
        {
            writer.WriteString("workspace_id", workspaceId.Value);
        }

        switch (claims.Origin)
        {
            case InvocationOrigin.Session session:
                writer.WriteString(
                    "session_id",
                    session.SessionId.Value);
                break;
            case InvocationOrigin.Run run:
                writer.WriteString("run_id", run.RunId.Value);
                break;
            default:
                throw new InvalidOperationException(
                    "Invocation origin is invalid");
        }

        writer.WriteNumber(
            "iat",
            claims.IssuedAt.Value.ToUnixTimeSeconds());
        writer.WriteNumber(
            "nbf",
            claims.IssuedAt.Value.ToUnixTimeSeconds());
        writer.WriteNumber(
            "exp",
            claims.ExpiresAt.Value.ToUnixTimeSeconds());
        writer.WriteString("jti", claims.TokenId.Value);
        writer.WriteEndObject();
        writer.Flush();
        return buffer.WrittenSpan.ToArray();
    }

    private static string EncodeBase64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
