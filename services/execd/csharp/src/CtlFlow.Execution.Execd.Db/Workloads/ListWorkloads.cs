using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Workloads;

public sealed record WorkloadPage(
    IReadOnlyList<WorkloadRecord> Workloads,
    WorkloadId? NextAfter);

public static partial class Workloads
{
    public static async Task<WorkloadPage> ListWorkloads(
        ExecutionDatabase database,
        PlacementId placementId,
        PageSize pageSize,
        WorkloadId? after,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "list_workloads");
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var placement = placementId.Value;
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var ids = new List<WorkloadId>(take);
        if (after is null)
        {
            var rows = await context.Workloads
                .AsNoTracking()
                .Where(item =>
                    EF.Property<string>(item, "PlacementId")
                        == placement)
                .OrderBy(item =>
                    EF.Property<string>(item, "WorkloadId"))
                .Select(item =>
                    new
                    {
                        WorkloadId =
                            EF.Property<string>(item, "WorkloadId")
                    })
                .Take(take)
                .ToListAsync(queryCancellation);
            ids.AddRange(rows.Select(row =>
                WorkloadId.Parse(row.WorkloadId)));
        }
        else
        {
            var afterValue = after.Value;
            var rows = await context.Workloads
                .AsNoTracking()
                .Where(item =>
                    EF.Property<string>(item, "PlacementId")
                        == placement
                    && string.Compare(
                        EF.Property<string>(item, "WorkloadId"),
                        afterValue) > 0)
                .OrderBy(item =>
                    EF.Property<string>(item, "WorkloadId"))
                .Select(item =>
                    new
                    {
                        WorkloadId =
                            EF.Property<string>(item, "WorkloadId")
                    })
                .Take(take)
                .ToListAsync(queryCancellation);
            ids.AddRange(rows.Select(row =>
                WorkloadId.Parse(row.WorkloadId)));
        }

        var hasMore = ids.Count > pageSize.Value;
        if (hasMore)
        {
            ids.RemoveAt(ids.Count - 1);
        }

        var records = new List<WorkloadRecord>(ids.Count);
        foreach (var id in ids)
        {
            records.Add(
                await LoadWorkload(
                    database,
                    id,
                    queryCancellation)
                ?? throw new InvalidOperationException(
                    "Listed Workload disappeared"));
        }

        return new WorkloadPage(
            records,
            hasMore && records.Count > 0
                ? records[^1].Id
                : null);
    }
}
