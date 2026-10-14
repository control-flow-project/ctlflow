using System.Text.RegularExpressions;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public static partial class FleetAuthority
{
    [GeneratedRegex(@"^fleet\.([a-f0-9-]{36})\.[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex CredentialPattern();

    public static string ControllerToken(string enrollmentId, string claimSecret)
        => "fleet." + enrollmentId + "." + Kernel.Identity.Hash("crossfire-controller:" + claimSecret);

    public static Result<FleetControllerActor> Authenticate(FleetPorts ports, string token)
    {
        var matched = CredentialPattern().Match(token);
        if (!matched.Success) return Results.Fail<FleetControllerActor>("unauthorized", "Invalid controller credential");
        var credential = ports.Credential(matched.Groups[1].Value);
        if (!credential.IsSuccess) return Result<FleetControllerActor>.Fail(credential.Error);
        if (credential.Value is null || credential.Value.RevokedAt is not null || !Kernel.Identity.Matches(token, credential.Value.SecretHash))
            return Results.Fail<FleetControllerActor>("unauthorized", "Invalid controller credential");
        var fleet = ports.Find(credential.Value.FleetId);
        if (!fleet.IsSuccess) return Result<FleetControllerActor>.Fail(fleet.Error);
        if (fleet.Value is null || fleet.Value.ArchivedAt is not null) return Results.Fail<FleetControllerActor>("unauthorized", "Fleet is unavailable");
        var owner = ports.Authorization.Principal(fleet.Value.OwnerId);
        if (!owner.IsSuccess) return Result<FleetControllerActor>.Fail(owner.Error);
        return owner.Value?.Status == "active" ? Result<FleetControllerActor>.Success(new(fleet.Value.Id, credential.Value.Id))
            : Results.Fail<FleetControllerActor>("forbidden", "Fleet owner is not active");
    }

    private static string Permission(FleetRecord fleet, string principalId, bool write)
        => "agent." + (write ? "configure" : "read") + (fleet.OwnerId == principalId ? ".owned" : ".any");

    public static Result<bool> Requester(FleetPorts ports, string principalId, FleetRecord fleet)
    {
        var principal = ports.Authorization.Principal(principalId);
        if (!principal.IsSuccess) return Result<bool>.Fail(principal.Error);
        if (principal.Value is not { Kind: "human", Status: "active" }) return Result<bool>.Success(false);
        return ports.Authorization.Permissions(principalId).Map(values => values.Contains(Permission(fleet, principalId, true), StringComparer.Ordinal));
    }

    public static Result<Unit> Authorize(FleetPorts ports, FleetActor actor, FleetRecord fleet, bool write = false)
    {
        if (write && fleet.ArchivedAt is not null) return Results.Fail<Unit>("forbidden", "Fleet is archived");
        if (actor is FleetPrincipalActor principal)
            return Authorization.Require(ports.Authorization, principal.Identity, Permission(fleet, principal.Identity.PrincipalId, write)).Map(_ => default(Unit));
        if (actor is not FleetControllerActor controller) return Results.Fail<Unit>("forbidden", "Controller authority does not cover this fleet");
        if (fleet.ArchivedAt is not null) return Results.Fail<Unit>("forbidden", "Fleet is archived");
        var credential = ports.Credential(controller.CredentialId);
        if (!credential.IsSuccess) return Result<Unit>.Fail(credential.Error);
        var owner = ports.Authorization.Principal(fleet.OwnerId);
        if (!owner.IsSuccess) return Result<Unit>.Fail(owner.Error);
        return controller.FleetId == fleet.Id && credential.Value is { RevokedAt: null } && credential.Value.FleetId == fleet.Id && owner.Value?.Status == "active"
            ? Results.Done() : Results.Fail<Unit>("forbidden", "Controller authority does not cover this fleet");
    }

    public static Result<FleetRecord> Find(FleetPorts ports, FleetActor actor, string fleetId, bool write = false)
    {
        if (actor is FleetPrincipalActor { Identity.Kind: "agent" })
            return Results.Fail<FleetRecord>("forbidden", "Only the fleet owner, an administrator or its controller may control this fleet");
        var found = ports.Find(fleetId);
        if (!found.IsSuccess) return Result<FleetRecord>.Fail(found.Error);
        if (found.Value is null) return Results.Fail<FleetRecord>("missing", "Fleet not found");
        return Authorize(ports, actor, found.Value, write).Map(_ => found.Value);
    }

    public static Result<FleetLiveConnection> Live(FleetPorts ports, FleetActor actor, string fleetId, string connectionId)
    {
        if (actor is not FleetControllerActor controller) return Results.Fail<FleetLiveConnection>("forbidden", "A live fleet controller connection is required");
        var fleet = Find(ports, actor, fleetId);
        if (!fleet.IsSuccess) return Result<FleetLiveConnection>.Fail(fleet.Error);
        var connection = ports.Connection(fleetId);
        if (!connection.IsSuccess) return Result<FleetLiveConnection>.Fail(connection.Error);
        if (connection.Value is null || connection.Value.ConnectionId != connectionId || connection.Value.CredentialId != controller.CredentialId
            || connection.Value.ClosedAt is not null || connection.Value.ExpiresAt <= ports.Authorization.Now())
            return Results.Fail<FleetLiveConnection>("conflict", "Controller connection expired or was replaced");
        return Result<FleetLiveConnection>.Success(new(fleet.Value, connection.Value));
    }
}
