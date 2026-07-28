using System.Text.Json;
using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Service.Security.Tokens;
using static CtlFlow.Policy.Policyd.Service.Security.Tokens.JsonWebTokens;

namespace CtlFlow.Policy.Policyd.Service.Security.Invocations;

internal static partial class InvocationTokens
{
    internal static async ValueTask<InvocationIdentity>
        ValidateInvocationToken(
            string token,
            TokenValidationSettings settings,
            VerificationKeys keys,
            DateTimeOffset currentTime,
            CancellationToken cancellation)
    {
        var common = await ValidateToken(
            token,
            settings,
            keys,
            currentTime,
            cancellation);
        try
        {
            var subject = PrincipalId.Parse(common.Subject);
            if (subject.Kind == PrincipalKind.Virtual)
            {
                throw new TokenValidationException();
            }

            var payload = common.Payload;
            var sessionId = ReadOptionalString(payload, "session_id");
            var runId = ReadOptionalString(payload, "run_id");
            if ((sessionId is null) == (runId is null))
            {
                throw new TokenValidationException();
            }
            ValidateContextId(sessionId ?? runId!);
            ValidateContextId(ReadRequiredString(payload, "jti"));
            var actor = ReadActor(
                payload,
                subject,
                sessionId is not null);
            RejectAuthorityClaims(payload);

            var tenantValue = ReadOptionalString(payload, "tenant_id");
            var tenant = tenantValue is null
                ? (TenantId?)null
                : TenantId.Parse(tenantValue);
            var workspaceValue =
                ReadOptionalString(payload, "workspace_id");
            var workspace = workspaceValue is null
                ? (WorkspaceId?)null
                : WorkspaceId.Parse(workspaceValue);
            if (workspace is not null && tenant is null)
            {
                throw new TokenValidationException();
            }
            if (sessionId is not null
                && (subject.Kind != PrincipalKind.Human
                    || tenant is null))
            {
                throw new TokenValidationException();
            }

            return new InvocationIdentity(
                subject,
                actor,
                tenant,
                workspace,
                new InvocationToken(token));
        }
        catch (ArgumentException)
        {
            throw new TokenValidationException();
        }
    }

    private static PrincipalId ReadActor(
        JsonElement payload,
        PrincipalId subject,
        bool sessionOrigin)
    {
        if (!payload.TryGetProperty("act", out var actor))
        {
            return subject;
        }
        if (sessionOrigin
            || actor.ValueKind != JsonValueKind.Object
            || actor.EnumerateObject().Count() != 1)
        {
            throw new TokenValidationException();
        }
        var actorId = PrincipalId.Parse(
            ReadRequiredString(actor, "sub"));
        return actorId.Kind != PrincipalKind.Virtual
            ? throw new TokenValidationException()
            : actorId;
    }

    private static void RejectAuthorityClaims(JsonElement payload)
    {
        foreach (var name in new[]
        {
            "role",
            "roles",
            "permission",
            "permissions",
            "scope",
            "scopes",
            "endpoint",
            "endpoints",
            "traceparent",
            "tracestate"
        })
        {
            if (payload.TryGetProperty(name, out _))
            {
                throw new TokenValidationException();
            }
        }
    }

    private static void ValidateContextId(string value)
    {
        if (value.Length is < 1 or > 128
            || value[0] is not (>= 'a' and <= 'z')
                and not (>= '0' and <= '9'))
        {
            throw new TokenValidationException();
        }
        foreach (var character in value.AsSpan(1))
        {
            if (character is not (>= 'a' and <= 'z')
                    and not (>= '0' and <= '9')
                && character is not '_' and not '-' and not '.' and not '~')
            {
                throw new TokenValidationException();
            }
        }
    }
}
