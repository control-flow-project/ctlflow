using System.Data;
using CtlFlow.Tenancy.Tenantd.Db.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.IdempotencyRecords;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceEvents;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    private const string RetryWorkspaceOperation = "retry_workspace";

    public static async Task<ResourceMutationResult<WorkspaceResource>>
        RetryWorkspaceLifecycleResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            RetryLifecycleCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (command.Target is not LifecycleTarget.Workspace target)
        {
            throw new ArgumentException(
                "Workspace retry requires a Workspace target",
                nameof(command));
        }

        using var dbActivity = TenantDbTelemetry.StartOperation(
            "retry_workspace_lifecycle");
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
        var queryOperationName = RetryWorkspaceOperation;
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
                target,
                cancellation);
        }

        var workspaceId = target.WorkspaceId.Value;
        var workspaceRow = await database.Workspaces
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_id") == workspaceId)
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                TenantId = EF.Property<string>(value, "_tenantId"),
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
        if (workspaceRow is null
            || workspaceRow.TenantId != target.TenantId.Value)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>.NotFound();
        }

        var workspace = await RestoreWorkspace(
            WorkspaceId.FromStorage(workspaceRow.Id),
            TenantId.FromStorage(workspaceRow.TenantId),
            workspaceRow.DisplayName,
            workspaceRow.Lifecycle,
            workspaceRow.Revision,
            workspaceRow.ProvisioningGeneration,
            workspaceRow.CurrentOperationId is null
                ? null
                : LifecycleOperationId.FromStorage(
                    workspaceRow.CurrentOperationId),
            workspaceRow.LastEventSequence,
            workspaceRow.CreatedAt,
            workspaceRow.UpdatedAt,
            cancellation);
        database.Attach(workspace);
        database.Entry(workspace)
            .Property(value => value.Revision)
            .OriginalValue = workspaceRow.Revision;

        if (workspace.LastEventSequence != command.ExpectedResourceVersion)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>.Aborted(
                ResourceMutationFailure.ResourceVersionMismatch);
        }

        var tenantId = target.TenantId.Value;
        var parentActive = await database.Tenants
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_id") == tenantId
                && value.Lifecycle == LifecycleState.Active)
            .AnyAsync(queryCancellation);
        if (!parentActive)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>
                .FailedPrecondition(
                    ResourceMutationFailure.ParentTenantNotActive);
        }

        var operationId = workspace.CurrentOperationId;
        if (workspace.Lifecycle != LifecycleState.Failed
            || operationId is null)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>
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
                WorkspaceId.FromStorage(operationRow.WorkspaceId!)),
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
            return new ResourceMutationResult<WorkspaceResource>
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
        await RetryWorkspaceLifecycle(
            workspace,
            operation.Kind,
            operationId,
            eventSequence,
            now,
            cancellation);
        AddWorkspaceResourceEvent(
            database,
            workspace,
            ResourceEventKind.Modified,
            steps,
            now);
        AddIdempotencyRecord(
            database,
            command.Actor,
            RetryWorkspaceOperation,
            command.IdempotencyKey,
            command.RequestDigest,
            2,
            workspaceId,
            operationId.Value,
            workspace.Revision.Value,
            workspace.Lifecycle,
            workspace.ProvisioningGeneration.Value,
            null,
            null,
            eventSequence.Value,
            now);
        AddAuditOutboxEntry(
            database,
            command.Actor,
            null,
            RetryWorkspaceOperation,
            eventSequence,
            2,
            tenantId,
            workspaceId,
            workspaceId,
            workspace.Revision.Value,
            command.IdempotencyKey,
            auditCorrelation,
            now);
        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        var resource = await LoadWorkspaceResource(
            databaseContexts,
            workspace.Id,
            cancellation);
        return new ResourceMutationResult<WorkspaceResource>.Succeeded(
            resource);
    }

    private static async Task<
        ResourceMutationResult<WorkspaceResource>> ResolveRepeatedRetry(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            RetryLifecycleCommand command,
            LifecycleTarget.Workspace target,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 2
            || repeated.ResourceId != target.WorkspaceId.Value)
        {
            return new ResourceMutationResult<WorkspaceResource>
                .AlreadyExists(ResourceMutationFailure.IdempotencyConflict);
        }

        return new ResourceMutationResult<WorkspaceResource>.Succeeded(
            await LoadWorkspaceResourceEvent(
                databaseContexts,
                Domain.Sequences.ResourceEventSequence.FromStorage(
                    repeated.ResultEventSequence),
                cancellation));
    }
}
