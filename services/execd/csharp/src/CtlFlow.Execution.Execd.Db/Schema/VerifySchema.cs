using CtlFlow.Execution.Execd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        ExecutionDatabase executionDatabase,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = ExecutionDbTelemetry.StartOperation(
            "verify_schema");
        var ledger = await VerifyMigrationLedger(executionDatabase, cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await using var database = await executionDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await database.Placements
            .AsNoTracking()
            .OrderBy(row => EF.Property<string>(row, "PlacementId"))
            .Select(row => new
            {
                PlacementId = EF.Property<string>(row, "PlacementId"),
                Revision = EF.Property<long>(row, "Revision"),
                StatusRevision = EF.Property<long>(row, "StatusRevision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Workloads
            .AsNoTracking()
            .OrderBy(row => EF.Property<string>(row, "WorkloadId"))
            .Select(row => new
            {
                WorkloadId = EF.Property<string>(row, "WorkloadId"),
                Revision = EF.Property<long>(row, "Revision"),
                StatusRevision = EF.Property<long>(row, "StatusRevision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Runs
            .AsNoTracking()
            .OrderBy(row => EF.Property<string>(row, "RunId"))
            .Select(row => new
            {
                RunId = EF.Property<string>(row, "RunId"),
                Revision = EF.Property<long>(row, "Revision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);

        return SchemaCompatibility.Compatible;
    }
}
