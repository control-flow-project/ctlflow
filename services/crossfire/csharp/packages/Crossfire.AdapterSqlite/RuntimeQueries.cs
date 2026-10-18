using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public sealed record RuntimeStopTime(string AgentId, long? At);
public sealed record AgentRuntimeState(string AgentId, RuntimeStateObservation Observation);

public static class RuntimeQueries
{
    public static Result<IReadOnlyList<RuntimeObservation>> Observations(CrossfireDbContext context, string agentId)
    {
        var rows = Stored.Read(() => context.RuntimeObservation.AsNoTracking()
            .Where(row => row.RunId == context.ListenerRun.Where(run => run.AgentId == agentId)
                .OrderByDescending(run => run.StartedAt).ThenByDescending(run => run.Id).Select(run => run.Id).FirstOrDefault())
            .OrderByDescending(row => row.ObservedAt).ThenBy(row => row.SessionId).ToArray());
        if (!rows.IsSuccess) return Result<IReadOnlyList<RuntimeObservation>>.Fail(rows.Error);
        if (rows.Value.Length == 0) return Result<IReadOnlyList<RuntimeObservation>>.Success([]);
        var runId = rows.Value[0].RunId;
        var settings = Stored.Read(() => context.RuntimeSetting.AsNoTracking().Where(row => row.RunId == runId).OrderBy(row => row.Name).ToArray());
        return settings.Map<IReadOnlyList<RuntimeObservation>>(values =>
        {
            var bySession = values.ToLookup(setting => setting.SessionId, StringComparer.Ordinal);
            return rows.Value.Select(row => new RuntimeObservation(row.RunId, row.SessionId, row.RoomId, row.Runtime,
                row.State, row.ObservedAt, row.LastActivityAt, row.HistoryAvailable is null ? null : row.HistoryAvailable == 1, row.HistoryMode, row.MaxInputBytes,
                bySession[row.SessionId].Select(setting => new RuntimeSetting(setting.Name, setting.ConfiguredValue, setting.EffectiveValue)).ToArray(), row.ErrorMessage)).ToArray();
        });
    }

    public static Result<RuntimeSummary?> Summary(CrossfireDbContext context, string agentId)
        => Summaries(context, [agentId]).Map(values => values.GetValueOrDefault(agentId));

    public static Result<IReadOnlyDictionary<string, RuntimeSummary?>> Summaries(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        var latest = ListenerQueries.Latest(context, ids);
        if (!latest.IsSuccess) return Result<IReadOnlyDictionary<string, RuntimeSummary?>>.Fail(latest.Error);
        var runIds = latest.Value.Select(run => run.Id).ToArray();
        var stoppedRunIds = latest.Value.Where(run => run.StoppedAt is not null).Select(run => run.Id).ToArray();
        var observations = Stored.Read(() => context.RuntimeObservation.AsNoTracking().Where(row => runIds.Contains(row.RunId))
            .Select(row => new AgentRuntimeState(row.AgentId, new RuntimeStateObservation(row.State, row.ObservedAt,
                row.LastActivityAt, row.HistoryAvailable == null ? null : row.HistoryAvailable == 1))).ToArray());
        if (!observations.IsSuccess) return Result<IReadOnlyDictionary<string, RuntimeSummary?>>.Fail(observations.Error);
        var proof = Stored.Read(() => context.FleetNativeStop.AsNoTracking().Where(row => stoppedRunIds.Contains(row.RunId) && row.InvalidatedAt == null)
            .GroupBy(row => row.AgentId).Select(group => new RuntimeStopTime(group.Key, group.Max(row => row.NativeStoppedAt))).ToArray());
        if (!proof.IsSuccess) return Result<IReadOnlyDictionary<string, RuntimeSummary?>>.Fail(proof.Error);
        var operations = Stored.Read(() => context.ListenerRun.AsNoTracking().Where(row => stoppedRunIds.Contains(row.Id))
            .Join(context.FleetRuntimeOperation.Where(row => row.Action == "stop" && row.Status == "succeeded"), run => run.ControllerFleetId, operation => operation.FleetId, (run, operation) => new { run, operation })
            .Where(joined => (joined.operation.AgentId == null || joined.operation.AgentId == joined.run.AgentId) && joined.operation.CompletedAt >= joined.run.StoppedAt)
            .GroupBy(joined => joined.run.AgentId).Select(group => new RuntimeStopTime(group.Key, group.Max(joined => joined.operation.CompletedAt))).ToArray());
        return operations.Map<IReadOnlyDictionary<string, RuntimeSummary?>>(values =>
        {
            var byAgent = observations.Value.ToLookup(value => value.AgentId, value => value.Observation, StringComparer.Ordinal);
            var stopped = proof.Value.Concat(values).Where(value => value.At is not null).GroupBy(value => value.AgentId).ToDictionary(group => group.Key, group => group.Max(value => value.At), StringComparer.Ordinal);
            return ids.ToDictionary(id => id, id => RuntimeObservations.WithStop(RuntimeObservations.Summarize(byAgent[id].ToArray()), stopped.GetValueOrDefault(id)), StringComparer.Ordinal);
        });
    }

}
