using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public sealed record RuntimeStopTime(string AgentId, long? At);
public sealed record AgentRuntimeState(string AgentId, RuntimeStateObservation Observation);

public static class RuntimeQueries
{
    public static Result<IReadOnlyList<RuntimeObservation>> Observations(CrossfireDbContext context, string agentId)
        => Load(context, [agentId]).Map<IReadOnlyList<RuntimeObservation>>(values => values.Where(value => value.AgentId == agentId).Select(value => value.Observation).ToArray());

    public static Result<RuntimeSummary?> Summary(CrossfireDbContext context, string agentId)
        => Summaries(context, [agentId]).Map(values => values.GetValueOrDefault(agentId));

    public static Result<IReadOnlyDictionary<string, RuntimeSummary?>> Summaries(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        var observations = Stored.Read(() => context.RuntimeObservation.AsNoTracking().Where(row => ids.Contains(row.AgentId))
            .Join(context.ListenerRun, observation => observation.RunId, run => run.Id, (observation, run) => new { observation, run })
            .Where(joined => !context.ListenerRun.Any(other => other.AgentId == joined.run.AgentId && (other.StartedAt > joined.run.StartedAt || other.StartedAt == joined.run.StartedAt && string.Compare(other.Id, joined.run.Id) > 0)))
            .Select(joined => new AgentRuntimeState(joined.observation.AgentId, new RuntimeStateObservation(joined.observation.State, joined.observation.ObservedAt,
                joined.observation.LastActivityAt, joined.observation.HistoryAvailable == null ? null : joined.observation.HistoryAvailable == 1))).ToArray());
        if (!observations.IsSuccess) return Result<IReadOnlyDictionary<string, RuntimeSummary?>>.Fail(observations.Error);
        var proof = Stored.Read(() => context.FleetNativeStop.AsNoTracking().Where(row => ids.Contains(row.AgentId) && row.InvalidatedAt == null)
            .Join(context.ListenerRun.Where(row => row.StoppedAt != null), proof => proof.RunId, run => run.Id, (proof, run) => new { proof, run })
            .Where(joined => !context.ListenerRun.Any(other => other.AgentId == joined.run.AgentId && (other.StartedAt > joined.run.StartedAt || other.StartedAt == joined.run.StartedAt && string.Compare(other.Id, joined.run.Id) > 0)))
            .GroupBy(joined => joined.run.AgentId).Select(group => new RuntimeStopTime(group.Key, group.Max(joined => joined.proof.NativeStoppedAt))).ToArray());
        if (!proof.IsSuccess) return Result<IReadOnlyDictionary<string, RuntimeSummary?>>.Fail(proof.Error);
        var operations = Stored.Read(() => context.ListenerRun.AsNoTracking().Where(row => ids.Contains(row.AgentId) && row.StoppedAt != null)
            .Where(run => !context.ListenerRun.Any(other => other.AgentId == run.AgentId && (other.StartedAt > run.StartedAt || other.StartedAt == run.StartedAt && string.Compare(other.Id, run.Id) > 0)))
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

    private static Result<IReadOnlyList<AgentObservation>> Load(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        var runs = Stored.Read(() => context.ListenerRun.AsNoTracking().Where(run => ids.Contains(run.AgentId)
            && !context.ListenerRun.Any(other => other.AgentId == run.AgentId && (other.StartedAt > run.StartedAt || other.StartedAt == run.StartedAt && string.Compare(other.Id, run.Id) > 0))).Select(row => row.Id).ToArray());
        if (!runs.IsSuccess) return Result<IReadOnlyList<AgentObservation>>.Fail(runs.Error);
        var runIds = runs.Value;
        var rows = Stored.Read(() => context.RuntimeObservation.AsNoTracking().Where(row => runIds.Contains(row.RunId)).OrderByDescending(row => row.ObservedAt).ThenBy(row => row.SessionId).ToArray());
        if (!rows.IsSuccess) return Result<IReadOnlyList<AgentObservation>>.Fail(rows.Error);
        var settings = Stored.Read(() => context.RuntimeSetting.AsNoTracking().Where(row => runIds.Contains(row.RunId)).OrderBy(row => row.Name).ToArray());
        return settings.Map<IReadOnlyList<AgentObservation>>(values =>
        {
            var bySession = values.ToLookup(setting => (setting.RunId, setting.SessionId));
            return rows.Value.Select(row => new AgentObservation(row.AgentId, new RuntimeObservation(row.RunId, row.SessionId, row.RoomId, row.Runtime,
                row.State, row.ObservedAt, row.LastActivityAt, row.HistoryAvailable is null ? null : row.HistoryAvailable == 1, row.HistoryMode, row.MaxInputBytes,
                bySession[(row.RunId, row.SessionId)].Select(setting => new RuntimeSetting(setting.Name, setting.ConfiguredValue, setting.EffectiveValue)).ToArray(), row.ErrorMessage))).ToArray();
        });
    }

    private sealed record AgentObservation(string AgentId, RuntimeObservation Observation);
}
