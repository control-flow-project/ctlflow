using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleWork;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.IdempotencyRecords;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceEvents;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<ResourceMutationResult<WorkspaceResource>>
        BeginWorkspaceLifecycleResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            LifecycleActionCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var operationName = GetWorkspaceOperationName(command.Operation);
        if (command.Target is not LifecycleTarget.Workspace target)
        {
            throw new ArgumentException(
                "Workspace lifecycle command requires a Workspace target",
                nameof(command));
        }

        using var dbActivity = TenantDbTelemetry.StartOperation(
            "begin_workspace_lifecycle");
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

        if (!WorkspaceTransitionIsAdmitted(
                workspace.Lifecycle,
                command.Operation))
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>
                .FailedPrecondition(
                    ResourceMutationFailure.LifecycleNotAdmitted);
        }

        var operationId = LifecycleOperationId.Generate();
        await BeginWorkspaceLifecycle(
            workspace,
            command.Operation,
            operationId,
            eventSequence,
            now,
            cancellation);
        var operation = await CreateLifecycleOperation(
            operationId,
            target,
            command.Operation,
            workspace.ProvisioningGeneration.Value,
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
        AddWorkspaceResourceEvent(
            database,
            workspace,
            ResourceEventKind.Modified,
            steps,
            now);
        AddIdempotencyRecord(
            database,
            command.Actor,
            operationName,
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
            operationName,
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
        ResourceMutationResult<WorkspaceResource>> ResolveRepeatedLifecycle(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            LifecycleActionCommand command,
            string operationName,
            LifecycleTarget.Workspace target,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 2
            || repeated.ResourceId != target.WorkspaceId.Value
            || repeated.OperationName != operationName)
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

    private static bool WorkspaceTransitionIsAdmitted(
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

    private static string GetWorkspaceOperationName(
        LifecycleOperationKind operation) =>
        operation switch
        {
            LifecycleOperationKind.Suspend => "suspend_workspace",
            LifecycleOperationKind.Resume => "resume_workspace",
            LifecycleOperationKind.Delete => "delete_workspace",
            _ => throw new ArgumentOutOfRangeException(nameof(operation))
        };
}
