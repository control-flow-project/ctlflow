using System.Text.Json;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using static CtlFlow.Execution.Execd.Service.Security.Tokens.JsonWebTokens;
using DomainTenantId =
    CtlFlow.Execution.Execd.Domain.Identifiers.TenantId;
using DomainWorkspaceId =
    CtlFlow.Execution.Execd.Domain.Identifiers.WorkspaceId;
using SecurityPrincipalId =
    CtlFlow.Execution.Execd.Service.Security.Principals.PrincipalId;

namespace CtlFlow.Execution.Execd.Service.Security.Invocations;

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
        var subject = SecurityPrincipalId.Parse(common.Subject);
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
        DomainWorkspaceId? workspaceId = null;
        if (workspaceValue is not null)
        {
            ValidateScopeId(workspaceValue);
            if (tenantId is null)
            {
                throw new TokenValidationException();
            }

            workspaceId = DomainWorkspaceId.Parse(workspaceValue);
        }

        if (sessionId is not null
            && (subject.Kind != "user" || tenantId is null))
        {
            throw new TokenValidationException();
        }

        return new InvocationIdentity(
            subject,
            actor,
            tenantId,
            workspaceId,
            tokenId,
            new InvocationToken(token));
    }

    private static SecurityPrincipalId ReadActor(
        JsonElement payload,
        SecurityPrincipalId subject,
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

        var actorId = SecurityPrincipalId.Parse(
            ReadRequiredString(actor, "sub"));
        return actorId == subject
            ? throw new TokenValidationException()
            : actorId;
    }

    private static ValueTask<DomainTenantId?> ReadTenantId(
        JsonElement payload,
        CancellationToken cancellation)
    {
        var value = ReadOptionalString(payload, "tenant_id");
        if (value is null)
        {
            return ValueTask.FromResult<DomainTenantId?>(null);
        }

        try
        {
            cancellation.ThrowIfCancellationRequested();
            return ValueTask.FromResult<DomainTenantId?>(
                DomainTenantId.Parse(value));
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
