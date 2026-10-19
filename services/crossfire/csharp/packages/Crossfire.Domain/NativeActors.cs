using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record NativeActorPorts(AuthorizationPorts Authorization, Func<string, Result<Principal?>> PrincipalByBackendUserId,
    Func<string, CancellationToken, ValueTask<Result<string>>> Identify);

public static class NativeActors
{
    public static async ValueTask<Result<Actor>> Principal(NativeActorPorts ports, string token, CancellationToken cancellation = default)
    {
        var identity = await ports.Identify(token, cancellation);
        if (!identity.IsSuccess) return Result<Actor>.Fail(identity.Error);
        var principal = ports.PrincipalByBackendUserId(identity.Value);
        if (!principal.IsSuccess) return Result<Actor>.Fail(principal.Error);
        if (principal.Value is null) return Results.Fail<Actor>("forbidden", "Registered identity authentication is required");
        var actor = new Actor(principal.Value.Id, principal.Value.Kind, new NativeAuthentication(identity.Value));
        return Authorization.ActiveActor(ports.Authorization, actor).Map(_ => actor);
    }

    public static async ValueTask<Result<Actor>> Agent(NativeActorPorts ports, string token, CancellationToken cancellation = default)
    {
        var actor = await Principal(ports, token, cancellation);
        return !actor.IsSuccess || actor.Value.Kind == "agent" ? actor : Results.Fail<Actor>("forbidden", "Registered agent authentication is required");
    }
}

public static class OwnerScopes
{
    public static Result<string?> Read(AuthorizationPorts ports, Actor actor, string permission, string? requestedOwnerId = null)
    {
        if (permission is not ("agent.read" or "enrollment.read" or "audit.read" or "wake-rule.read"))
            return Results.Fail<string?>("invalid", "Invalid owner-scoped permission");
        var current = Authorization.ActiveActor(ports, actor);
        if (!current.IsSuccess) return Result<string?>.Fail(current.Error);
        var permissions = ports.Permissions(actor.PrincipalId);
        if (!permissions.IsSuccess) return Result<string?>.Fail(permissions.Error);
        if (permissions.Value.Contains(permission + ".any", StringComparer.Ordinal)) return Result<string?>.Success(requestedOwnerId);
        return !permissions.Value.Contains(permission + ".owned", StringComparer.Ordinal) || requestedOwnerId is not null && requestedOwnerId != actor.PrincipalId
            ? Results.Fail<string?>("forbidden", "This owner scope is not permitted") : Result<string?>.Success(actor.PrincipalId);
    }
}
