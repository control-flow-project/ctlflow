using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.IdempotencyRecords;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceEvents;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    private const string UpdateTenantOperation = "update_tenant";

    public static async Task<ResourceMutationResult<TenantResource>>
        UpdateTenantResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            UpdateTenantCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "update_tenant_resource");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var eventSequenceRow = await database.ResourceEventSequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => new
            {
                value.SequenceId,
                value.CurrentSequence,
                value.RetainedFromSequence
            })
            .SingleAsync(queryCancellation);
        var eventSequenceState = new Sequences.ResourceEventSequenceState(
            eventSequenceRow.SequenceId,
            eventSequenceRow.CurrentSequence,
            eventSequenceRow.RetainedFromSequence);
        database.Attach(eventSequenceState);
        var eventSequence = AllocateResourceEventSequence(eventSequenceState);
        await database.SaveChangesAsync(cancellation);

        var requestActor = command.Actor.Value;
        var idempotencyKey = command.IdempotencyKey.Value;
        var queryOperationName = UpdateTenantOperation;
        var repeated = await database.IdempotencyRecords
            .AsNoTracking()
            .Where(value =>
                value.RequestActor == requestActor
                && value.OperationName == queryOperationName
                && value.IdempotencyKey == idempotencyKey)
            .Select(value => new
            {
                value.RecordId,
                value.RequestActor,
                value.OperationName,
                value.IdempotencyKey,
                value.RequestHash,
                value.ResourceKind,
                value.ResourceId,
                value.LifecycleOperationId,
                value.ResultResourceRevision,
                value.ResultLifecycleState,
                value.ResultProvisioningGeneration,
                value.ResultStepRevision,
                value.ResultStepState,
                value.ResultEventSequence,
                value.CreatedAtUnixMilliseconds
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (repeated is not null)
        {
            await transaction.RollbackAsync(cancellation);
            return await ResolveRepeatedUpdate(
                databaseContexts,
                new Requests.IdempotencyRecord(
                    repeated.RecordId,
                    repeated.RequestActor,
                    repeated.OperationName,
                    repeated.IdempotencyKey,
                    repeated.RequestHash,
                    repeated.ResourceKind,
                    repeated.ResourceId,
                    repeated.LifecycleOperationId,
                    repeated.ResultResourceRevision,
                    repeated.ResultLifecycleState,
                    repeated.ResultProvisioningGeneration,
                    repeated.ResultStepRevision,
                    repeated.ResultStepState,
                    repeated.ResultEventSequence,
                    repeated.CreatedAtUnixMilliseconds),
                command,
                cancellation);
        }

        var tenantId = command.TenantId.Value;
        var tenantRow = await database.Tenants
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_id") == tenantId)
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                value.DisplayName,
                value.Lifecycle,
                value.Revision,
                value.ProvisioningGeneration,
                CurrentOperationId = EF.Property<string?>(
                    value,
                    "_currentOperationId"),
                value.LastEventSequence,
                value.CreatedAt,
                value.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (tenantRow is null)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>.NotFound();
        }

        var tenant = await RestoreTenant(
            TenantId.FromStorage(tenantRow.Id),
            tenantRow.DisplayName,
            tenantRow.Lifecycle,
            tenantRow.Revision,
            tenantRow.ProvisioningGeneration,
            tenantRow.CurrentOperationId is null
                ? null
                : LifecycleOperationId.FromStorage(
                    tenantRow.CurrentOperationId),
            tenantRow.LastEventSequence,
            tenantRow.CreatedAt,
            tenantRow.UpdatedAt,
            cancellation);
        database.Attach(tenant);
        database.Entry(tenant)
            .Property(value => value.Revision)
            .OriginalValue = tenantRow.Revision;

        if (tenant.LastEventSequence != command.ExpectedResourceVersion)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>.Aborted(
                ResourceMutationFailure.ResourceVersionMismatch);
        }

        if (!IsDisplayMetadataUpdateAdmitted(tenant.Lifecycle))
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>
                .FailedPrecondition(
                    ResourceMutationFailure.LifecycleNotAdmitted);
        }

        var currentOperationId = tenant.CurrentOperationId?.Value;
        var stepRows = await database.LifecycleSteps
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_operationId")
                    == currentOperationId
                && value.State != LifecycleStepState.Complete)
            .OrderBy(value => value.Key)
            .Select(value => new
            {
                OperationId = EF.Property<string>(value, "_operationId"),
                value.Key,
                value.State,
                value.Revision,
                DeliverySequence = EF.Property<long>(
                    value,
                    "_deliverySequence"),
                value.OwnerRevision,
                value.BlockedReason,
                value.UpdatedAt
            })
            .ToListAsync(queryCancellation);
        var currentSteps = new List<LifecycleStep>(stepRows.Count);
        foreach (var row in stepRows)
        {
            currentSteps.Add(await RestoreLifecycleStep(
                LifecycleOperationId.FromStorage(row.OperationId),
                row.Key,
                row.State,
                row.Revision,
                LifecycleDeliverySequence.FromStorage(row.DeliverySequence),
                row.OwnerRevision,
                row.BlockedReason,
                row.UpdatedAt,
                cancellation));
        }

        await UpdateTenantDisplayName(
            tenant,
            command.DisplayName,
            eventSequence,
            now,
            cancellation);
        AddTenantResourceEvent(
            database,
            tenant,
            ResourceEventKind.Modified,
            currentSteps,
            now);
        AddIdempotencyRecord(
            database,
            command.Actor,
            UpdateTenantOperation,
            command.IdempotencyKey,
            command.RequestDigest,
            1,
            tenantId,
            null,
            tenant.Revision.Value,
            tenant.Lifecycle,
            tenant.ProvisioningGeneration.Value,
            null,
            null,
            eventSequence.Value,
            now);
        AddAuditOutboxEntry(
            database,
            command.Actor,
            null,
            UpdateTenantOperation,
            eventSequence,
            1,
            tenantId,
            null,
            tenantId,
            tenant.Revision.Value,
            command.IdempotencyKey,
            auditCorrelation,
            now);
        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        var resource = await LoadTenantResource(
            databaseContexts,
            tenant.Id,
            cancellation);
        return new ResourceMutationResult<TenantResource>.Succeeded(resource);
    }

    private static async Task<
        ResourceMutationResult<TenantResource>> ResolveRepeatedUpdate(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            UpdateTenantCommand command,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 1
            || repeated.ResourceId != command.TenantId.Value)
        {
            return new ResourceMutationResult<TenantResource>.AlreadyExists(
                ResourceMutationFailure.IdempotencyConflict);
        }

        return new ResourceMutationResult<TenantResource>.Succeeded(
            await LoadTenantResourceEvent(
                databaseContexts,
                Domain.Sequences.ResourceEventSequence.FromStorage(
                    repeated.ResultEventSequence),
                cancellation));
    }
}
