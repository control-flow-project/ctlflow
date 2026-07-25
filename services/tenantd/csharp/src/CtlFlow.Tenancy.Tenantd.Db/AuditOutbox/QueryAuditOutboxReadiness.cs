using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public static partial class AuditOutboxEntries
{
    public static async Task<AuditOutboxReadiness> QueryAuditOutboxReadiness(
        IDbContextFactory<TenantDbContext> databaseContexts,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "query_audit_outbox_readiness");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var states = await database.AuditOutboxStates
            .AsNoTracking()
            .Select(value => new
            {
                value.StateId,
                value.MaximumPending,
                value.PendingCount,
                value.PermanentlyBlocked,
                value.Revision
            })
            .ToListAsync(queryCancellation);
        if (states.Count != 1
            || states[0].StateId != 1
            || states[0].MaximumPending <= 0
            || states[0].PendingCount < 0
            || states[0].PermanentlyBlocked is not (0 or 1)
            || states[0].Revision <= 0)
        {
            return AuditOutboxReadiness.Inconsistent;
        }

        var actualCount = await database.AuditOutbox.CountAsync(
            queryCancellation);
        if (states[0].PendingCount != actualCount)
        {
            return AuditOutboxReadiness.Inconsistent;
        }

        if (states[0].PermanentlyBlocked == 1)
        {
            return AuditOutboxReadiness.PermanentlyBlocked;
        }

        return states[0].PendingCount >= states[0].MaximumPending
            ? AuditOutboxReadiness.CapacityExhausted
            : AuditOutboxReadiness.Ready;
    }
}
