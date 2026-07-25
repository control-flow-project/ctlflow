using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public static partial class AuditOutboxEntries
{
    public static async Task ReleaseAuditOutboxBatch(
        IDbContextFactory<TenantDbContext> databaseContexts,
        AuditLeaseId leaseId,
        UtcInstant availableAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "release_audit_outbox_batch");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var leaseValue = leaseId.Value;
        var rows = await database.AuditOutbox
            .AsNoTracking()
            .Where(value =>
                value.DeliveryState == 2
                && value.LeaseId == leaseValue)
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
        foreach (var row in rows)
        {
            var entry = RestoreAuditOutboxEntry(row);
            database.Attach(entry);
            entry.DeliveryState = 1;
            entry.Revision++;
            entry.AvailableAtUnixMilliseconds = availableAt.UnixMilliseconds;
            entry.LeaseId = null;
            entry.LeaseExpiresAtUnixMilliseconds = null;
            entry.FailureCode = null;
        }

        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
    }
}
