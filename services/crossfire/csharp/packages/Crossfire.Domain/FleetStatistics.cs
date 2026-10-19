using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record FleetStatisticsView(long CapturedAt, long Since, long RetentionDays, StatisticsSummary Summary,
    IReadOnlyList<PrincipalSummary> Agents, IReadOnlyList<PrincipalIdentity> Senders, int Page, int PageSize);

public static class FleetStatistics
{
    public static Result<FleetStatisticsView> Read(FleetPorts fleets, DiscoveryPorts discovery, StatisticsPorts statistics, FleetActor actor, string fleetId, int hours, int page, int size, long retentionDays)
    {
        if (hours is not (1 or 24 or 168 or 720) || page is < 1 or > 100000 || size is < 1 or > 100) return Results.Fail<FleetStatisticsView>("invalid", "Invalid statistics window or pagination");
        var fleet = FleetAuthority.Find(fleets, actor, fleetId); if (!fleet.IsSuccess) return Result<FleetStatisticsView>.Fail(fleet.Error);
        var instances = fleets.Bindings(fleet.Value); if (!instances.IsSuccess) return Result<FleetStatisticsView>.Fail(instances.Error);
        var ids = instances.Value.Select(value => value.AgentId).ToArray(); var now = fleets.Authorization.Now();
        var retainedSince = retentionDays > now / 86400000 ? 0 : now - retentionDays * 86400000;
        var since = Math.Max(now - hours * 3600000L, retainedSince);
        var agents = discovery.Selected(ids); if (!agents.IsSuccess) return Result<FleetStatisticsView>.Fail(agents.Error);
        if (agents.Value.Count != ids.Length) return Results.Fail<FleetStatisticsView>("unavailable", "Fleet agent records are missing");
        var measured = statistics.Read(ids, since, page, size); if (!measured.IsSuccess) return Result<FleetStatisticsView>.Fail(measured.Error);
        var senders = discovery.Identities(measured.Value.Flows.Select(flow => flow.SenderBackendUserId).Distinct(StringComparer.Ordinal).ToArray());
        return senders.Map(values => new FleetStatisticsView(now, since, retentionDays, measured.Value, agents.Value, values, page, size));
    }
}
