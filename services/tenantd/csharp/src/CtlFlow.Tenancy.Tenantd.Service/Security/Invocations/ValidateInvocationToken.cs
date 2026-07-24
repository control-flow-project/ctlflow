using System.Text.Json;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Security.Principals;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Tokens.JsonWebTokens;

namespace CtlFlow.Tenancy.Tenantd.Service.Security.Invocations;

internal static partial class InvocationTokens
{
    internal static async ValueTask<InvocationIdentity> ValidateInvocationToken(
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
        var subject = PrincipalId.Parse(common.Subject);
        if (subject.Kind is not ("user" or "service"))
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

        if (sessionId is not null)
        {
            ValidateContextId(sessionId, 128);
        }
        else
        {
            ValidateContextId(runId!, 128);
        }

        var actor = ReadActor(payload, subject, sessionId is not null);
        var tokenId = ReadRequiredString(payload, "jti");
        ValidateContextId(tokenId, 128);

        RejectAuthorityClaims(payload);
        var tenantId = await ReadTenantId(payload, cancellation);
        var workspaceValue = ReadOptionalString(payload, "workspace_id");
        WorkspaceId? workspaceId = null;
        if (workspaceValue is not null)
        {
            ValidateScopeId(workspaceValue);
            if (tenantId is null)
            {
                throw new TokenValidationException();
            }

            workspaceId = WorkspaceId.FromStorage(workspaceValue);
        }

        if (sessionId is not null
            && (subject.Kind != "user" || tenantId is null))
        {
            throw new TokenValidationException();
        }

        return new InvocationIdentity(subject, actor, tenantId, workspaceId, tokenId);
    }

    private static PrincipalId ReadActor(
        JsonElement payload,
        PrincipalId subject,
        bool sessionOrigin)
    {
        if (!payload.TryGetProperty("act", out var actor))
        {
            return sessionOrigin
                ? subject
                : throw new TokenValidationException();
        }

        if (sessionOrigin
            || actor.ValueKind != JsonValueKind.Object
            || actor.EnumerateObject().Count() != 1)
        {
            throw new TokenValidationException();
        }

        var actorId = PrincipalId.Parse(ReadRequiredString(actor, "sub"));
        return actorId == subject
            ? throw new TokenValidationException()
            : actorId;
    }

    private static async ValueTask<TenantId?> ReadTenantId(
        JsonElement payload,
        CancellationToken cancellation)
    {
        var value = ReadOptionalString(payload, "tenant_id");
        if (value is null)
        {
            return null;
        }

        try
        {
            return await TenantId.Parse(value, cancellation);
        }
        catch (ArgumentException)
        {
            throw new TokenValidationException();
        }
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

    private static void ValidateContextId(string value, int maximumLength)
    {
        if (value.Length is < 1 || value.Length > maximumLength
            || !IsLowerAlphaNumeric(value[0]))
        {
            throw new TokenValidationException();
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-' and not '.' and not '~')
            {
                throw new TokenValidationException();
            }
        }
    }

    private static void ValidateScopeId(string value)
    {
        if (value.Length is < 1 or > 64
            || !IsLowerAlphaNumeric(value[0]))
        {
            throw new TokenValidationException();
        }

        foreach (var character in value.AsSpan(1))
        {
            if (!IsLowerAlphaNumeric(character)
                && character is not '_' and not '-')
            {
                throw new TokenValidationException();
            }
        }
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
