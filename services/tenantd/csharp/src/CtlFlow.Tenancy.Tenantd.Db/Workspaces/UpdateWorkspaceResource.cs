using System.Data;
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
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    private const string UpdateWorkspaceOperation = "update_workspace";

    public static async Task<ResourceMutationResult<WorkspaceResource>>
        UpdateWorkspaceResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            UpdateWorkspaceCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "update_workspace_resource");
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
        var queryOperationName = UpdateWorkspaceOperation;
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

        var workspaceId = command.WorkspaceId.Value;
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
        if (workspaceRow is null)
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

        var tenantId = workspace.TenantId.Value;
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

        if (!IsDisplayMetadataUpdateAdmitted(workspace.Lifecycle))
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>
                .FailedPrecondition(
                    ResourceMutationFailure.LifecycleNotAdmitted);
        }

        var currentOperationId = workspace.CurrentOperationId?.Value;
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

        await UpdateWorkspaceDisplayName(
            workspace,
            command.DisplayName,
            eventSequence,
            now,
            cancellation);
        AddWorkspaceResourceEvent(
            database,
            workspace,
            ResourceEventKind.Modified,
            currentSteps,
            now);
        AddIdempotencyRecord(
            database,
            command.Actor,
            UpdateWorkspaceOperation,
            command.IdempotencyKey,
            command.RequestDigest,
            2,
            workspaceId,
            null,
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
            UpdateWorkspaceOperation,
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
        ResourceMutationResult<WorkspaceResource>> ResolveRepeatedUpdate(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            UpdateWorkspaceCommand command,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 2
            || repeated.ResourceId != command.WorkspaceId.Value)
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
