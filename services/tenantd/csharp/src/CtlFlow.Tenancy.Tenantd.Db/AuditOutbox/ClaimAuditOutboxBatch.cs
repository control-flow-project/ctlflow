using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Identifiers.StorageIdentifiers;

namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public static partial class AuditOutboxEntries
{
    public static async Task<ClaimAuditOutboxResult> ClaimAuditOutboxBatch(
        IDbContextFactory<TenantDbContext> databaseContexts,
        AuditBatchSize batchSize,
        UtcInstant now,
        UtcInstant leaseExpiresAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "claim_audit_outbox_batch");
        if (leaseExpiresAt.Value <= now.Value)
        {
            throw new ArgumentException(
                "Audit lease expiry must follow the claim time",
                nameof(leaseExpiresAt));
        }

        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var nowUnixMilliseconds = now.UnixMilliseconds;
        var requested = batchSize.Value;
        var rows = await database.AuditOutbox
            .AsNoTracking()
            .Where(value =>
                (value.DeliveryState == 1
                    && value.AvailableAtUnixMilliseconds
                        <= nowUnixMilliseconds)
                || (value.DeliveryState == 2
                    && value.LeaseExpiresAtUnixMilliseconds
                        <= nowUnixMilliseconds))
            .OrderBy(value => value.SourceSequence)
            .Take(requested)
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
        if (rows.Count == 0)
        {
            await transaction.RollbackAsync(cancellation);
            return new ClaimAuditOutboxResult.Empty();
        }

        var leaseId = AuditLeaseId.FromStorage(CreateStorageId("lease"));
        foreach (var row in rows)
        {
            var entry = RestoreAuditOutboxEntry(row);
            database.Attach(entry);
            entry.DeliveryState = 2;
            entry.DeliveryAttempts++;
            entry.Revision++;
            entry.LeaseId = leaseId.Value;
            entry.LeaseExpiresAtUnixMilliseconds =
                leaseExpiresAt.UnixMilliseconds;
            entry.FailureCode = null;
        }

        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return new ClaimAuditOutboxResult.Claimed(
            new AuditOutboxLease(
                leaseId,
                rows.Select(CreatePendingAuditEvent).ToArray()));
    }
}
