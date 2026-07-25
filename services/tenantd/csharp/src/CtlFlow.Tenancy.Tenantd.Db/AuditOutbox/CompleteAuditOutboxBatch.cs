using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public static partial class AuditOutboxEntries
{
    public static async Task CompleteAuditOutboxBatch(
        IDbContextFactory<TenantDbContext> databaseContexts,
        AuditOutboxLease lease,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "complete_audit_outbox_batch");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var leaseId = lease.LeaseId.Value;
        var rows = await database.AuditOutbox
            .AsNoTracking()
            .Where(value =>
                value.DeliveryState == 2
                && value.LeaseId == leaseId)
            .OrderBy(value => value.SourceSequence)
            .Select(value => new AuditOutboxRow(
                value.OutboxId,
                value.SourceEventId,
                value.SourceSequence,
                value.OperatorSubject,
                value.ImmediateCaller,
                value.OperationName,
                value.ResourceKind,
                value.TenantId,
                value.WorkspaceId,
                value.ResourceId,
                value.ResourceRevision,
                value.IdempotencyKey,
                value.OccurredAtUnixMilliseconds,
                value.TraceId,
                value.SpanId,
                value.DeliveryState,
                value.DeliveryAttempts,
                value.Revision,
                value.AvailableAtUnixMilliseconds,
                value.LeaseId,
                value.LeaseExpiresAtUnixMilliseconds,
                value.FailureCode))
            .ToListAsync(queryCancellation);
        if (rows.Count != lease.Events.Count
            || rows.Where((row, index) =>
                    row.SourceEventId
                    != lease.Events[index].SourceEventId.Value)
                .Any())
        {
            throw new InvalidOperationException(
                "Audit outbox completion does not match the claimed lease");
        }

        foreach (var row in rows)
        {
            database.AuditOutbox.Remove(RestoreAuditOutboxEntry(row));
        }

        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
    }
}
