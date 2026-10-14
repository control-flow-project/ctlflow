using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record FleetMetadata(string FleetId, string Key, string Value);
public sealed record FleetDetails(FleetRecord Record, PrincipalSummary Owner, IReadOnlyDictionary<string, string> Metadata, FleetConnectionView Connection, bool CanArchive, IReadOnlyList<string> AllowedActions);
public sealed record FleetReadPorts(FleetPorts Fleets, DiscoveryPorts Discovery, AgentReadPorts Agents,
    Func<int, int, string?, string, Result<Page<FleetRecord>>> Page,
    Func<IReadOnlyList<string>, Result<IReadOnlyList<FleetMetadata>>> Metadata,
    Func<IReadOnlyList<string>, Result<IReadOnlyList<FleetConnection>>> Connections,
    Func<IReadOnlyList<string>, IReadOnlyList<string>, long, Result<RetirementSnapshot>> Retirement,
    Func<string, IReadOnlyDictionary<string, string>, Result<Unit>> ReplaceMetadata);

public static class FleetReads
{
    private static Result<IReadOnlyList<FleetDetails>> Details(FleetReadPorts ports, FleetActor actor, IReadOnlyList<FleetRecord> records)
    {
        var ids = records.Select(value => value.Id).ToArray(); var now = ports.Fleets.Authorization.Now();
        var metadata = ports.Metadata(ids); if (!metadata.IsSuccess) return Result<IReadOnlyList<FleetDetails>>.Fail(metadata.Error);
        var connections = ports.Connections(ids); if (!connections.IsSuccess) return Result<IReadOnlyList<FleetDetails>>.Fail(connections.Error);
        var owners = ports.Discovery.Selected(records.Select(value => value.OwnerId).Distinct(StringComparer.Ordinal).ToArray()); if (!owners.IsSuccess) return Result<IReadOnlyList<FleetDetails>>.Fail(owners.Error);
        var retirement = ports.Retirement([], ids, now); if (!retirement.IsSuccess) return Result<IReadOnlyList<FleetDetails>>.Fail(retirement.Error);
        var permissions = actor is FleetPrincipalActor principal ? ports.Fleets.Authorization.Permissions(principal.Identity.PrincipalId) : Result<IReadOnlyList<string>>.Success([]);
        if (!permissions.IsSuccess) return Result<IReadOnlyList<FleetDetails>>.Fail(permissions.Error);
        var byOwner = owners.Value.ToDictionary(value => value.PrincipalId, StringComparer.Ordinal); var byConnection = connections.Value.ToDictionary(value => value.FleetId, StringComparer.Ordinal);
        var byMetadata = metadata.Value.ToLookup(value => value.FleetId, StringComparer.Ordinal); var byRetirement = retirement.Value.Agents.ToLookup(value => value.FleetId, StringComparer.Ordinal);
        if (records.Any(value => !byOwner.ContainsKey(value.OwnerId))) return Results.Fail<IReadOnlyList<FleetDetails>>("unavailable", "Fleet owner record is missing");
        return Result<IReadOnlyList<FleetDetails>>.Success(records.Select(record =>
        {
            var connection = byConnection.GetValueOrDefault(record.Id);
            var configure = record.ArchivedAt is null && (actor is FleetControllerActor || actor is FleetPrincipalActor acting
                && (permissions.Value.Contains("agent.configure.any", StringComparer.Ordinal) || acting.Identity.PrincipalId == record.OwnerId && permissions.Value.Contains("agent.configure.owned", StringComparer.Ordinal)));
            var live = actor is not FleetControllerActor controller || connection is { ClosedAt: null } && connection.CredentialId == controller.CredentialId && connection.ExpiresAt > now;
            var archive = configure && actor is not FleetPrincipalActor { Identity.Kind: "agent" } && live && !retirement.Value.PendingFleetIds.Contains(record.Id, StringComparer.Ordinal)
                && byRetirement[record.Id].All(value => FleetRetirement.Eligible(value, now));
            return new FleetDetails(record, byOwner[record.OwnerId], byMetadata[record.Id].ToDictionary(value => value.Key, value => value.Value, StringComparer.Ordinal), FleetValues.Connection(connection, now), archive,
                !configure ? [] : archive ? ["configure", "archive"] : ["configure"]);
        }).ToArray());
    }

    public static Result<FleetDetails> Read(FleetReadPorts ports, FleetActor actor, string fleetId)
    {
        var fleet = ports.Fleets.Find(fleetId); if (!fleet.IsSuccess) return Result<FleetDetails>.Fail(fleet.Error);
        if (fleet.Value is null) return Results.Fail<FleetDetails>("missing", "Fleet not found");
        var authority = FleetAuthority.Authorize(ports.Fleets, actor, fleet.Value); if (!authority.IsSuccess) return Result<FleetDetails>.Fail(authority.Error);
        return Details(ports, actor, [fleet.Value]).Map(values => values[0]);
    }

    public static Result<Page<FleetDetails>> List(FleetReadPorts ports, Actor actor, int page, int size, string? ownerId, string search)
    {
        var scope = OwnerScopes.Read(ports.Fleets.Authorization, actor, "agent.read", ownerId); if (!scope.IsSuccess) return Result<Page<FleetDetails>>.Fail(scope.Error);
        var records = ports.Page(page, size, scope.Value, search); if (!records.IsSuccess) return Result<Page<FleetDetails>>.Fail(records.Error);
        return Details(ports, new FleetPrincipalActor(actor), records.Value.Items).Map(values => new Page<FleetDetails>(values, page, size, records.Value.TotalItems));
    }

    public static Result<Page<AgentDetails>> Agents(FleetReadPorts ports, FleetActor actor, string fleetId, int page, int size)
    {
        var fleet = Read(ports, actor, fleetId); if (!fleet.IsSuccess) return Result<Page<AgentDetails>>.Fail(fleet.Error);
        var bindings = ports.Fleets.Bindings(fleet.Value.Record); if (!bindings.IsSuccess) return Result<Page<AgentDetails>>.Fail(bindings.Error);
        var records = ports.Agents.Page(new(page, size, fleet.Value.Record.OwnerId, ["active", "suspended", "revoked"], "", "all", bindings.Value.Select(value => value.AgentId).ToArray()));
        if (!records.IsSuccess) return Result<Page<AgentDetails>>.Fail(records.Error);
        return AgentReads.Details(ports.Agents, actor, records.Value.Items).Map(values => new Page<AgentDetails>(values, page, size, records.Value.TotalItems));
    }

    public static Result<FleetDetails> Change(FleetReadPorts ports, FleetActor actor, string fleetId, long revision, string label, ControllerDescription controller, string requestId)
    {
        var valid = EnrollmentValidation.Controller(controller); if (!valid.IsSuccess) return Result<FleetDetails>.Fail(valid.Error);
        if (TextRules.Blank(label) || label.Length > 100) return Results.Fail<FleetDetails>("invalid", "Fleet label must contain 1–100 characters");
        return ports.Fleets.Transaction.Run(() =>
        {
            var fleet = ports.Fleets.Find(fleetId); if (!fleet.IsSuccess) return Result<FleetDetails>.Fail(fleet.Error);
            if (fleet.Value is null) return Results.Fail<FleetDetails>("missing", "Fleet not found");
            var authority = FleetAuthority.Authorize(ports.Fleets, actor, fleet.Value, true); if (!authority.IsSuccess) return Result<FleetDetails>.Fail(authority.Error);
            if (fleet.Value.Revision != revision) return Results.Fail<FleetDetails>("stale_revision", "Fleet changed; refresh before saving");
            var metadata = ports.ReplaceMetadata(fleetId, controller.Metadata); if (!metadata.IsSuccess) return Result<FleetDetails>.Fail(metadata.Error);
            var saved = ports.Fleets.Save(fleet.Value with { Label = label, ControllerName = controller.Name, Revision = checked(revision + 1), UpdatedAt = ports.Fleets.Authorization.Now() });
            if (!saved.IsSuccess) return Result<FleetDetails>.Fail(saved.Error);
            var audit = ports.Fleets.Audit(FleetValues.Audit(actor, requestId, fleet.Value, "fleet.configure"));
            return audit.IsSuccess ? Read(ports, actor, fleetId) : Result<FleetDetails>.Fail(audit.Error);
        });
    }
}
