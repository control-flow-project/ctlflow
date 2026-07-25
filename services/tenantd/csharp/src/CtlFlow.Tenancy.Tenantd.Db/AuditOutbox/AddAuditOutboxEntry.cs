using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Db.Identifiers.StorageIdentifiers;

namespace CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;

public static partial class AuditOutboxEntries
{
    internal static void AddAuditOutboxEntry(
        TenantDbContext database,
        RequestActor operatorSubject,
        RequestActor? immediateCaller,
        string operationName,
        ResourceEventSequence sourceSequence,
        int resourceKind,
        string tenantId,
        string? workspaceId,
        string resourceId,
        long resourceRevision,
        IdempotencyKey idempotencyKey,
        AuditCorrelation correlation,
        UtcInstant now)
    {
        database.AuditOutbox.Add(new AuditOutboxEntry(
            CreateStorageId("out"),
            CreateStorageId("evt"),
            sourceSequence.Value,
            operatorSubject.Value,
            immediateCaller?.Value,
            operationName,
            resourceKind,
            tenantId,
            workspaceId,
            resourceId,
            resourceRevision,
            idempotencyKey.Value,
            now.UnixMilliseconds,
            correlation.TraceId.Value,
            correlation.SpanId.Value));
    }
}
