using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleWork;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.IdempotencyRecords;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceEvents;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<ResourceMutationResult<TenantResource>>
        BeginTenantLifecycleResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            LifecycleActionCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var operationName = GetTenantOperationName(command.Operation);
        if (command.Target is not LifecycleTarget.Tenant target)
        {
            throw new ArgumentException(
                "Tenant lifecycle command requires a Tenant target",
                nameof(command));
        }

        using var dbActivity = TenantDbTelemetry.StartOperation(
            "begin_tenant_lifecycle");
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
        var repeated = await database.IdempotencyRecords
            .AsNoTracking()
            .Where(value =>
                value.RequestActor == requestActor
                && value.OperationName == operationName
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
            return await ResolveRepeatedLifecycle(
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
                operationName,
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

        if (!TenantTransitionIsAdmitted(
                tenant.Lifecycle,
                command.Operation))
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>
                .FailedPrecondition(
                    ResourceMutationFailure.LifecycleNotAdmitted);
        }

        if (command.Operation == LifecycleOperationKind.Delete
            && await database.Workspaces
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_tenantId") == tenantId
                    && value.Lifecycle != LifecycleState.Deleted)
                .AnyAsync(queryCancellation))
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>
                .FailedPrecondition(
                    ResourceMutationFailure.TenantHasWorkspaces);
        }

        var operationId = LifecycleOperationId.Generate();
        await BeginTenantLifecycle(
            tenant,
            command.Operation,
            operationId,
            eventSequence,
            now,
            cancellation);
        var operation = await CreateLifecycleOperation(
            operationId,
            target,
            command.Operation,
            tenant.ProvisioningGeneration.Value,
            command.Actor,
            command.IdempotencyKey,
            command.RequestDigest,
            now,
            cancellation);
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
            4);
        database.LifecycleOperations.Add(operation);
        var steps = await AddLifecycleSteps(
            database,
            operationId,
            deliverySequences,
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
            operationName,
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
            operationName,
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
        ResourceMutationResult<TenantResource>> ResolveRepeatedLifecycle(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            LifecycleActionCommand command,
            string operationName,
            TenantId tenantId,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 1
            || repeated.ResourceId != tenantId.Value
            || repeated.OperationName != operationName)
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

    private static bool TenantTransitionIsAdmitted(
        LifecycleState state,
        LifecycleOperationKind operation) =>
        operation switch
        {
            LifecycleOperationKind.Suspend => state == LifecycleState.Active,
            LifecycleOperationKind.Resume => state == LifecycleState.Suspended,
            LifecycleOperationKind.Delete =>
                state is LifecycleState.Active
                    or LifecycleState.Suspended
                    or LifecycleState.Failed,
            _ => false
        };

    private static string GetTenantOperationName(
        LifecycleOperationKind operation) =>
        operation switch
        {
            LifecycleOperationKind.Suspend => "suspend_tenant",
            LifecycleOperationKind.Resume => "resume_tenant",
            LifecycleOperationKind.Delete => "delete_tenant",
            _ => throw new ArgumentOutOfRangeException(nameof(operation))
        };
}
