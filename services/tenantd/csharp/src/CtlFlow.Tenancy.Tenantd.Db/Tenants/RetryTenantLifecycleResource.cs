using System.Data;
using CtlFlow.Tenancy.Tenantd.Db.Lifecycles;
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

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    private const string RetryTenantOperation = "retry_tenant";

    public static async Task<ResourceMutationResult<TenantResource>>
        RetryTenantLifecycleResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            RetryLifecycleCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (command.Target is not LifecycleTarget.Tenant target)
        {
            throw new ArgumentException(
                "Tenant retry requires a Tenant target",
                nameof(command));
        }

        using var dbActivity = TenantDbTelemetry.StartOperation(
            "retry_tenant_lifecycle");
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
        var queryOperationName = RetryTenantOperation;
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
            return await ResolveRepeatedRetry(
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
                target.TenantId,
                cancellation);
        }

        var tenantId = target.TenantId.Value;
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

        var operationId = tenant.CurrentOperationId;
        if (tenant.Lifecycle != LifecycleState.Failed
            || operationId is null)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>
                .FailedPrecondition(
                    ResourceMutationFailure.OperationNotRetryable);
        }

        var id = operationId.Value;
        var operationRow = await database.LifecycleOperations
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_operationId") == id)
            .Select(value => new
            {
                OperationId = EF.Property<string>(value, "_operationId"),
                TargetKind = EF.Property<int>(value, "TargetKind"),
                TenantId = EF.Property<string>(value, "_tenantId"),
                WorkspaceId = EF.Property<string?>(value, "_workspaceId"),
                value.Kind,
                value.DesiredLifecycle,
                value.ProvisioningGeneration,
                value.State,
                value.RequestActor,
                value.IdempotencyKey,
                value.RequestDigest,
                value.CreatedAt,
                value.UpdatedAt
            })
            .SingleAsync(queryCancellation);
        var stepRows = await database.LifecycleSteps
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_operationId") == id)
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
        LifecycleTarget operationTarget = operationRow.TargetKind switch
        {
            1 => new LifecycleTarget.Tenant(
                TenantId.FromStorage(operationRow.TenantId)),
            2 => new LifecycleTarget.Workspace(
                TenantId.FromStorage(operationRow.TenantId),
                Domain.Workspaces.WorkspaceId.FromStorage(
                    operationRow.WorkspaceId!)),
            _ => throw new InvalidOperationException(
                "Stored lifecycle target kind is invalid")
        };
        var operation = await RestoreLifecycleOperation(
            LifecycleOperationId.FromStorage(operationRow.OperationId),
            operationTarget,
            operationRow.Kind,
            operationRow.DesiredLifecycle,
            operationRow.ProvisioningGeneration,
            operationRow.State,
            operationRow.RequestActor,
            operationRow.IdempotencyKey,
            operationRow.RequestDigest,
            operationRow.CreatedAt,
            operationRow.UpdatedAt,
            cancellation);
        database.Attach(operation);
        var steps = new List<LifecycleStep>(stepRows.Count);
        foreach (var row in stepRows)
        {
            var step = await RestoreLifecycleStep(
                LifecycleOperationId.FromStorage(row.OperationId),
                row.Key,
                row.State,
                row.Revision,
                LifecycleDeliverySequence.FromStorage(row.DeliverySequence),
                row.OwnerRevision,
                row.BlockedReason,
                row.UpdatedAt,
                cancellation);
            database.Attach(step);
            database.Entry(step)
                .Property(value => value.Revision)
                .OriginalValue = row.Revision;
            steps.Add(step);
        }
        var blockedSteps = steps
            .Where(value => value.State == LifecycleStepState.Blocked)
            .ToArray();
        if (operation.State != LifecycleOperationState.Blocked
            || blockedSteps.Length == 0)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>
                .FailedPrecondition(
                    ResourceMutationFailure.OperationNotRetryable);
        }

        var deliverySequenceRow = await database.LifecycleDeliverySequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => new
            {
                value.SequenceId,
                value.CurrentSequence
            })
            .SingleAsync(queryCancellation);
        var deliverySequenceState =
            new Sequences.LifecycleDeliverySequenceState(
                deliverySequenceRow.SequenceId,
                deliverySequenceRow.CurrentSequence);
        database.Attach(deliverySequenceState);
        var deliverySequences = AllocateLifecycleDeliverySequences(
            deliverySequenceState,
            blockedSteps.Length);
        for (var index = 0; index < blockedSteps.Length; index++)
        {
            var step = blockedSteps[index];
            await RetryLifecycleStep(
                step,
                deliverySequences[index],
                now,
                cancellation);
            database.LifecycleDeliveries.Add(new LifecycleDelivery(
                step.DeliverySequence.Value,
                operationId.Value,
                step.Key,
                step.Revision.Value,
                now.UnixMilliseconds));
        }

        await UpdateLifecycleOperationState(
            operation,
            blocked: false,
            complete: false,
            now,
            cancellation);
        await RetryTenantLifecycle(
            tenant,
            operation.Kind,
            operationId,
            eventSequence,
            now,
            cancellation);
        AddTenantResourceEvent(
            database,
            tenant,
            ResourceEventKind.Modified,
            steps,
            now);
        AddIdempotencyRecord(
            database,
            command.Actor,
            RetryTenantOperation,
            command.IdempotencyKey,
            command.RequestDigest,
            1,
            tenantId,
            operationId.Value,
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
            RetryTenantOperation,
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
        ResourceMutationResult<TenantResource>> ResolveRepeatedRetry(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            RetryLifecycleCommand command,
            TenantId tenantId,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 1
            || repeated.ResourceId != tenantId.Value)
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
