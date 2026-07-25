using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Db.Identifiers.StorageIdentifiers;

namespace CtlFlow.Tenancy.Tenantd.Db.Requests;

internal static partial class IdempotencyRecords
{
    internal static void AddIdempotencyRecord(
        TenantDbContext database,
        RequestActor actor,
        string operationName,
        IdempotencyKey idempotencyKey,
        RequestDigest requestDigest,
        int resourceKind,
        string resourceId,
        string? lifecycleOperationId,
        long resourceRevision,
        LifecycleState lifecycle,
        long provisioningGeneration,
        long? stepRevision,
        LifecycleStepState? stepState,
        long eventSequence,
        UtcInstant now)
    {
        database.IdempotencyRecords.Add(new IdempotencyRecord(
            CreateStorageId("idem"),
            actor.Value,
            operationName,
            idempotencyKey.Value,
            requestDigest.Value,
            resourceKind,
            resourceId,
            lifecycleOperationId,
            resourceRevision,
            LifecycleStates.ToStorage(lifecycle),
            provisioningGeneration,
            stepRevision,
            stepState is null ? null : (int)stepState.Value,
            eventSequence,
            now.UnixMilliseconds));
    }
}
