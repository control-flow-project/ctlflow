using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Placements;

public sealed record PlacementPage(
    IReadOnlyList<PlacementRecord> Placements,
    PlacementId? NextAfter);

public static partial class Placements
{
    public static async Task<PlacementPage> ListPlacements(
        ExecutionDatabase database,
        PlacementTarget target,
        PageSize pageSize,
        PlacementId? after,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "list_placements");
        await using var context = await database.Contexts.CreateDbContextAsync(
            cancellation);
        var (targetKind, tenantId, workspaceId, accountPrincipalId) =
            GetTargetValues(target);
        var take = pageSize.Value + 1;
        var queryCancellation = cancellation;
        var ids = new List<PlacementId>(take);
        if (after is null)
        {
            var rows = await context.Placements
                .AsNoTracking()
                .Where(row =>
                    EF.Property<int>(row, "TargetKind") == targetKind
                    && EF.Property<string?>(row, "TenantId") == tenantId
                    && EF.Property<string?>(row, "WorkspaceId")
                        == workspaceId
                    && EF.Property<string?>(row, "AccountPrincipalId")
                        == accountPrincipalId)
                .OrderBy(row =>
                    EF.Property<string>(row, "PlacementId"))
                .Select(row => new
                {
                    PlacementId =
                        EF.Property<string>(row, "PlacementId")
                })
                .Take(take)
                .ToListAsync(queryCancellation);
            ids.AddRange(rows.Select(row =>
                PlacementId.Parse(row.PlacementId)));
        }
        else
        {
            var afterValue = after.Value;
            var rows = await context.Placements
                .AsNoTracking()
                .Where(row =>
                    EF.Property<int>(row, "TargetKind") == targetKind
                    && EF.Property<string?>(row, "TenantId") == tenantId
                    && EF.Property<string?>(row, "WorkspaceId")
                        == workspaceId
                    && EF.Property<string?>(row, "AccountPrincipalId")
                        == accountPrincipalId
                    && string.Compare(
                        EF.Property<string>(row, "PlacementId"),
                        afterValue) > 0)
                .OrderBy(row =>
                    EF.Property<string>(row, "PlacementId"))
                .Select(row => new
                {
                    PlacementId =
                        EF.Property<string>(row, "PlacementId")
                })
                .Take(take)
                .ToListAsync(queryCancellation);
            ids.AddRange(rows.Select(row =>
                PlacementId.Parse(row.PlacementId)));
        }

        var hasMore = ids.Count > pageSize.Value;
        if (hasMore)
        {
            ids.RemoveAt(ids.Count - 1);
        }

        var records = new List<PlacementRecord>(ids.Count);
        foreach (var id in ids)
        {
            records.Add(
                await LoadPlacement(database, id, queryCancellation)
                ?? throw new InvalidOperationException(
                    "Placement disappeared during listing"));
        }

        return new PlacementPage(
            records,
            hasMore && records.Count > 0 ? records[^1].Id : null);
    }

    private static (
        int TargetKind,
        string? TenantId,
        string? WorkspaceId,
        string? AccountPrincipalId)
        GetTargetValues(PlacementTarget target) =>
        target switch
        {
            PlacementTarget.Global => (1, null, null, null),
            PlacementTarget.Tenant tenant =>
                (2, tenant.TenantId.Value, null, null),
            PlacementTarget.Workspace workspace => (
                3,
                workspace.TenantId.Value,
                workspace.WorkspaceId.Value,
                null),
            PlacementTarget.User user => (
                4,
                user.TenantId.Value,
                null,
                user.AccountPrincipalId.Value),
            _ => throw new InvalidOperationException(
                "Placement target is invalid")
        };
}
