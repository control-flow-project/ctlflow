using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Runs;

public sealed record RunPage(
    IReadOnlyList<RunRecord> Runs,
    RunId? NextAfter);

public static partial class Runs
{
    public static async Task<RunPage> ListRuns(
        ExecutionDatabase database,
        WorkloadId workloadId,
        PageSize pageSize,
        RunId? after,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "list_runs");
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var workload = workloadId.Value;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var ids = new List<RunId>(take);
        if (after is null)
        {
            var rows = await context.Runs
                .AsNoTracking()
                .Where(item =>
                    EF.Property<string>(item, "WorkloadId")
                        == workload)
                .OrderBy(item =>
                    EF.Property<string>(item, "RunId"))
                .Select(item =>
                    new
                    {
                        RunId = EF.Property<string>(item, "RunId")
                    })
                .Take(take)
                .ToListAsync(queryCancellation);
            ids.AddRange(rows.Select(row =>
                RunId.Parse(row.RunId)));
        }
        else
        {
            var afterValue = after.Value;
            var rows = await context.Runs
                .AsNoTracking()
                .Where(item =>
                    EF.Property<string>(item, "WorkloadId")
                        == workload
                    && string.Compare(
                        EF.Property<string>(item, "RunId"),
                        afterValue) > 0)
                .OrderBy(item =>
                    EF.Property<string>(item, "RunId"))
                .Select(item =>
                    new
                    {
                        RunId = EF.Property<string>(item, "RunId")
                    })
                .Take(take)
                .ToListAsync(queryCancellation);
            ids.AddRange(rows.Select(row =>
                RunId.Parse(row.RunId)));
        }

        var hasMore = ids.Count > pageSize.Value;
        if (hasMore)
        {
            ids.RemoveAt(ids.Count - 1);
        }

        var records = new List<RunRecord>(ids.Count);
        foreach (var id in ids)
        {
            records.Add(
                await LoadRun(
                    database,
                    id,
                    queryCancellation)
                ?? throw new InvalidOperationException(
                    "Listed Run disappeared"));
        }

        return new RunPage(
            records,
            hasMore && records.Count > 0
                ? records[^1].Id
                : null);
    }
}
