using System.Text.Json;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using static CtlFlow.Identity.Identityd.Service.Security.Tokens.JsonWebTokens;

namespace CtlFlow.Identity.Identityd.Service.Security.Invocations;

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
            var subject = await AccountId.Parse(
                common.Subject,
                cancellation);
            var payload = common.Payload;
            var sessionId = ReadOptionalString(payload, "session_id");
            var runId = ReadOptionalString(payload, "run_id");
            if ((sessionId is null) == (runId is null))
            {
                throw new TokenValidationException();
            }

            ValidateContextId(sessionId ?? runId!, 128);
            var actor = await ReadActor(
                payload,
                subject,
                sessionId is not null,
                cancellation);
            ValidateContextId(ReadRequiredString(payload, "jti"), 128);
            RejectAuthorityClaims(payload);

            var tenant = await TenantId.Parse(
                ReadRequiredString(payload, "tenant_id"),
                cancellation);
            var workspaceValue =
                ReadOptionalString(payload, "workspace_id");
            var workspace = workspaceValue is null
                ? null
                : await WorkspaceId.Parse(
                    workspaceValue,
                    cancellation);
            if (sessionId is not null
                && subject.Kind != AccountKind.Human)
            {
                throw new TokenValidationException();
            }

            return new InvocationIdentity(
                subject,
                actor,
                new IdentityTarget(tenant, workspace));
        }
        catch (ArgumentException)
        {
            throw new TokenValidationException();
        }
    }

    private static async ValueTask<PrincipalId> ReadActor(
        JsonElement payload,
        AccountId subject,
        bool sessionOrigin,
        CancellationToken cancellation)
    {
        if (!payload.TryGetProperty("act", out var actor))
        {
            return subject.Principal;
        }

        if (sessionOrigin
            || actor.ValueKind != JsonValueKind.Object
            || actor.EnumerateObject().Count() != 1)
        {
            throw new TokenValidationException();
        }

        var actorId = await PrincipalId.Parse(
            ReadRequiredString(actor, "sub"),
            cancellation);
        return actorId.Kind != PrincipalKind.Virtual
            || actorId == subject.Principal
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

    private static void ValidateContextId(
        string value,
        int maximumLength)
    {
        if (value.Length is < 1
            || value.Length > maximumLength
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

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
