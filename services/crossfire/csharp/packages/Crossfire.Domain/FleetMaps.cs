using System.Globalization;
using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record AgentWakeSelection(string AgentId, string SenderPrincipalId, bool IncludeAgents);
public sealed record FleetMapRelations(IReadOnlyList<RoomGrant> Grants, IReadOnlyList<RoomGrantApplication> Applications, IReadOnlyList<AgentWakeSelection> Senders);
public sealed record FleetMapConnection(string AgentId, string RoomId, RoomGrant? Grant, RoomGrantApplication? Application);
public sealed record FleetMapRoom(string RoomId, string? Name, string? Alias);
public sealed record FleetMapSource(string SourceId, string Mode, IReadOnlyList<WakeSelection> Senders, IReadOnlyList<string> EligiblePrincipalIds);
public sealed record FleetMapAgent(AgentDetails Agent, string SourceId);
public sealed record FleetMap(FleetDetails Fleet, long CapturedAt, IReadOnlyList<FleetMapAgent> Agents, IReadOnlyList<FleetMapRoom> Rooms,
    IReadOnlyList<FleetMapConnection> Connections, IReadOnlyList<FleetMapSource> Sources, IReadOnlyList<PrincipalSummary> Principals);
public sealed record FleetMapPorts(FleetReadPorts Fleets, Func<Result<IReadOnlyList<ActiveIdentity>>> Identities,
    Func<IReadOnlyList<string>, Result<FleetMapRelations>> Relations,
    Func<string, string, CancellationToken, ValueTask<Result<RoomDetails>>> Room);

public static class FleetMaps
{
    private static readonly StringComparer Ordering = StringComparer.Create(CultureInfo.GetCultureInfo("en-US"), false);
    public static async ValueTask<Result<FleetMap>> Read(FleetMapPorts ports, Actor actor, string fleetId, CancellationToken cancellation = default)
    {
        var fleet = FleetReads.Read(ports.Fleets, new FleetPrincipalActor(actor), fleetId); if (!fleet.IsSuccess) return Result<FleetMap>.Fail(fleet.Error);
        var captured = ports.Fleets.Fleets.Authorization.Now(); var instances = ports.Fleets.Fleets.Bindings(fleet.Value.Record); if (!instances.IsSuccess) return Result<FleetMap>.Fail(instances.Error);
        if (instances.Value.Count > 1000) return Results.Fail<FleetMap>("limit", "Fleet map exceeds the agent limit");
        var ids = instances.Value.Select(value => value.AgentId).ToArray();
        var entries = ports.Fleets.Agents.Page(new(1, Math.Max(1, ids.Length), fleet.Value.Record.OwnerId, ["active", "suspended", "revoked"], "", "all", ids)); if (!entries.IsSuccess) return Result<FleetMap>.Fail(entries.Error);
        if (entries.Value.TotalItems != ids.Length) return Results.Fail<FleetMap>("unavailable", "Fleet map has an incomplete agent directory");
        var records = AgentReads.Details(ports.Fleets.Agents, new FleetPrincipalActor(actor), entries.Value.Items); if (!records.IsSuccess) return Result<FleetMap>.Fail(records.Error);
        var relations = ports.Relations(ids); if (!relations.IsSuccess) return Result<FleetMap>.Fail(relations.Error);
        var byKey = relations.Value.Grants.ToDictionary(value => (value.AgentId, value.RoomId), value => new FleetMapConnection(value.AgentId, value.RoomId, value, null));
        foreach (var application in relations.Value.Applications)
        {
            var key = (application.AgentId, application.RoomId);
            byKey[key] = byKey.TryGetValue(key, out var connection) ? connection with { Application = application } : new(application.AgentId, application.RoomId, null, application);
        }
        var connections = byKey.Values.Where(value => value.Grant is { AccessMode: not "none" } || value.Application?.Membership is "join" or "invite"
            || !string.IsNullOrEmpty(value.Application?.ErrorCode) || !string.IsNullOrEmpty(value.Application?.ErrorMessage) || value.Grant is not null && value.Application?.AppliedRevision != value.Grant.Revision)
            .OrderBy(value => value.AgentId, Ordering).ThenBy(value => value.RoomId, Ordering).ToArray();
        if (connections.Length > 10000) return Results.Fail<FleetMap>("limit", "Fleet map exceeds the connection limit");
        var observers = connections.GroupBy(value => value.RoomId, StringComparer.Ordinal).Select(group => group.OrderByDescending(value => value.Application?.Membership == "join").First()).OrderBy(value => value.RoomId, Ordering).ToArray();
        if (observers.Length > 2000) return Results.Fail<FleetMap>("limit", "Fleet map exceeds the room limit");
        var active = ports.Identities(); if (!active.IsSuccess) return Result<FleetMap>.Fail(active.Error);
        var activeByMatrix = active.Value.ToDictionary(value => value.Principal.MatrixUserId, value => value.Principal.Id, StringComparer.Ordinal);
        var senders = relations.Value.Senders.ToLookup(value => value.AgentId, StringComparer.Ordinal); var sources = new Dictionary<string, FleetMapSource>(StringComparer.Ordinal); var agents = new List<FleetMapAgent>(); var principalIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var record in records.Value)
        {
            var selections = senders[record.Record.Principal.Id].Select(value => new WakeSelection(value.SenderPrincipalId, value.IncludeAgents)).OrderBy(value => value.PrincipalId, Ordering).ToArray();
            var selected = selections.Select(value => new WakeSender(value.PrincipalId, value.IncludeAgents)).ToArray(); var sourceId = SourceId(record.Record.Agent.WakeMode, selections);
            var eligible = sources.TryGetValue(sourceId, out var previous) ? previous.EligiblePrincipalIds.ToHashSet(StringComparer.Ordinal) : new HashSet<string>(StringComparer.Ordinal);
            foreach (var matrixId in WakePolicy.SenderMatrixIds(record.Record, active.Value, selected)) eligible.Add(activeByMatrix[matrixId]);
            var source = new FleetMapSource(sourceId, record.Record.Agent.WakeMode, selections, eligible.Order(StringComparer.Ordinal).ToArray()); sources[sourceId] = source;
            principalIds.UnionWith(selections.Select(value => value.PrincipalId)); principalIds.UnionWith(eligible); agents.Add(new(record, sourceId));
        }
        if (principalIds.Count > 2000) return Results.Fail<FleetMap>("limit", "Fleet map exceeds the identity limit");
        var principals = ports.Fleets.Discovery.Selected(principalIds.ToArray()); if (!principals.IsSuccess) return Result<FleetMap>.Fail(principals.Error);
        if (principals.Value.Count != principalIds.Count) return Results.Fail<FleetMap>("unavailable", "Fleet map has an incomplete identity directory");
        var rooms = new FleetMapRoom[observers.Length]; var cursor = -1;
        async Task Labels()
        {
            for (;;)
            {
                var index = Interlocked.Increment(ref cursor); if (index >= observers.Length) return;
                var observer = observers[index]; var result = await ports.Room(observer.RoomId, observer.AgentId, cancellation);
                rooms[index] = new(observer.RoomId, result.IsSuccess && result.Value.Name != observer.RoomId ? result.Value.Name : null, result.IsSuccess ? result.Value.Alias : null);
            }
        }
        await Task.WhenAll(Enumerable.Range(0, Math.Min(4, observers.Length)).Select(_ => Labels()));
        var authorized = FleetReads.Read(ports.Fleets, new FleetPrincipalActor(actor), fleetId); if (!authorized.IsSuccess) return Result<FleetMap>.Fail(authorized.Error);
        return Result<FleetMap>.Success(new(fleet.Value, captured, agents, rooms, connections, sources.Values.OrderBy(value => value.SourceId, Ordering).ToArray(), principals.Value));
    }

    public static string SourceId(string mode, IReadOnlyList<WakeSelection> selections)
    {
        var output = new StringBuilder(mode).Append('\0').Append('['); var index = 0;
        foreach (var selection in selections)
        {
            if (index++ != 0) output.Append(',');
            output.Append("{\"principalId\":").Append(ProtocolJson.Quote(selection.PrincipalId)).Append(",\"includeAgents\":").Append(selection.IncludeAgents ? "true" : "false").Append('}');
        }
        return Identity.Hash(output.Append(']').ToString());
    }
}
