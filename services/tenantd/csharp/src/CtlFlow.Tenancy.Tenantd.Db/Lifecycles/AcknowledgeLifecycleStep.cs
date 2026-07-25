using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleWork;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.IdempotencyRecords;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Domain.Addresses.TenantAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.WorkspaceAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;
public static partial class Lifecycles
{
    private const string AcknowledgeOperation = "acknowledge_lifecycle_step";
    public static async Task<LifecycleAcknowledgementResult>
        AcknowledgeLifecycleStep(
            IDbContextFactory<TenantDbContext> databaseContexts,
            AcknowledgeLifecycleCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(AcknowledgeOperation);
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
        var queryOperationName = AcknowledgeOperation;
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
            return ResolveRepeatedAcknowledgement(
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
                command);
        }

        var operationId = command.OperationId.Value;
        var operationRow = await database.LifecycleOperations
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_operationId")
                == operationId)
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
            .SingleOrDefaultAsync(queryCancellation);
        if (operationRow is null
            || operationRow.ProvisioningGeneration
                != command.ProvisioningGeneration)
        {
            await transaction.RollbackAsync(cancellation);
            return new LifecycleAcknowledgementResult.StaleOperation();
        }

        var storedTarget = RestoreLifecycleTarget(
            operationRow.TargetKind,
            operationRow.TenantId,
            operationRow.WorkspaceId);
        if (storedTarget != command.Target)
        {
            await transaction.RollbackAsync(cancellation);
            return new LifecycleAcknowledgementResult.StaleOperation();
        }

        var operation = await RestoreLifecycleOperation(
            LifecycleOperationId.FromStorage(operationRow.OperationId),
            storedTarget,
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

        TargetState? targetState;
        if (command.Target is LifecycleTarget.Tenant tenantTarget)
        {
            var tenantId = tenantTarget.TenantId.Value;
            var tenantRow = await database.Tenants
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_id") == tenantId)
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
                targetState = null;
            }
            else
            {
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
                targetState = new TargetState(
                    1,
                    tenantId,
                    null,
                    tenantId,
                    tenant.CurrentOperationId,
                    tenant.ProvisioningGeneration.Value,
                    tenant,
                    null);
            }
        }
        else if (command.Target
            is LifecycleTarget.Workspace workspaceTarget)
        {
            var workspaceId = workspaceTarget.WorkspaceId.Value;
            var workspaceRow = await database.Workspaces
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_id") == workspaceId)
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
                || workspaceRow.TenantId != workspaceTarget.TenantId.Value)
            {
                targetState = null;
            }
            else
            {
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
                targetState = new TargetState(
                    2,
                    workspaceTarget.TenantId.Value,
                    workspaceId,
                    workspaceId,
                    workspace.CurrentOperationId,
                    workspace.ProvisioningGeneration.Value,
                    null,
                    workspace);
            }
        }
        else
        {
            throw new InvalidOperationException(
                "Lifecycle target is invalid");
        }

        if (targetState is null)
        {
            await transaction.RollbackAsync(cancellation);
            return new LifecycleAcknowledgementResult.NotFound();
        }

        if (targetState.CurrentOperationId != command.OperationId
            || targetState.ProvisioningGeneration
                != command.ProvisioningGeneration)
        {
            await transaction.RollbackAsync(cancellation);
            return new LifecycleAcknowledgementResult.StaleOperation();
        }

        var stepKey = command.StepKey;
        var stepRow = stepKey switch
        {
            LifecycleStepKey.Identity => await database.LifecycleSteps
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_operationId")
                        == operationId
                    && value.Key == LifecycleStepKey.Identity)
                .Select(value => new LifecycleStepRow(
                    EF.Property<string>(value, "_operationId"),
                    value.Key,
                    value.State,
                    value.Revision,
                    EF.Property<long>(value, "_deliverySequence"),
                    value.OwnerRevision,
                    value.BlockedReason,
                    value.UpdatedAt))
                .SingleOrDefaultAsync(queryCancellation),
            LifecycleStepKey.Configuration => await database.LifecycleSteps
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_operationId")
                        == operationId
                    && value.Key == LifecycleStepKey.Configuration)
                .Select(value => new LifecycleStepRow(
                    EF.Property<string>(value, "_operationId"),
                    value.Key,
                    value.State,
                    value.Revision,
                    EF.Property<long>(value, "_deliverySequence"),
                    value.OwnerRevision,
                    value.BlockedReason,
                    value.UpdatedAt))
                .SingleOrDefaultAsync(queryCancellation),
            LifecycleStepKey.Execution => await database.LifecycleSteps
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_operationId")
                        == operationId
                    && value.Key == LifecycleStepKey.Execution)
                .Select(value => new LifecycleStepRow(
                    EF.Property<string>(value, "_operationId"),
                    value.Key,
                    value.State,
                    value.Revision,
                    EF.Property<long>(value, "_deliverySequence"),
                    value.OwnerRevision,
                    value.BlockedReason,
                    value.UpdatedAt))
                .SingleOrDefaultAsync(queryCancellation),
            LifecycleStepKey.Packages => await database.LifecycleSteps
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_operationId")
                        == operationId
                    && value.Key == LifecycleStepKey.Packages)
                .Select(value => new LifecycleStepRow(
                    EF.Property<string>(value, "_operationId"),
                    value.Key,
                    value.State,
                    value.Revision,
                    EF.Property<long>(value, "_deliverySequence"),
                    value.OwnerRevision,
                    value.BlockedReason,
                    value.UpdatedAt))
                .SingleOrDefaultAsync(queryCancellation),
            _ => throw new InvalidOperationException(
                "Lifecycle step key is invalid")
        };
        if (stepRow is null)
        {
            await transaction.RollbackAsync(cancellation);
            return new LifecycleAcknowledgementResult.NotFound();
        }

        var step = await RestoreLifecycleStep(
            LifecycleOperationId.FromStorage(stepRow.OperationId),
            stepRow.Key,
            stepRow.State,
            stepRow.Revision,
            LifecycleDeliverySequence.FromStorage(
                stepRow.DeliverySequence),
            stepRow.OwnerRevision,
            stepRow.BlockedReason,
            stepRow.UpdatedAt,
            cancellation);
        database.Attach(step);
        database.Entry(step)
            .Property(value => value.Revision)
            .OriginalValue = stepRow.Revision;

        if (step.Revision != command.ExpectedStepRevision)
        {
            await transaction.RollbackAsync(cancellation);
            return new LifecycleAcknowledgementResult.RevisionConflict();
        }

        if (step.State != LifecycleStepState.Pending)
        {
            await transaction.RollbackAsync(cancellation);
            return new LifecycleAcknowledgementResult.StepNotPending();
        }

        await Domain.Lifecycles.LifecycleOperations
            .AcknowledgeLifecycleStep(
                step,
                command.Outcome,
                command.OwnerRevision,
                command.BlockedReason,
                now,
                cancellation);
        var allStepRows = await database.LifecycleSteps
            .AsNoTracking()
            .Where(value => EF.Property<string>(
                    value,
                    "_operationId")
                == operationId)
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
        var steps = new List<LifecycleStep>(allStepRows.Count);
        foreach (var row in allStepRows)
        {
            if (row.Key == step.Key)
            {
                steps.Add(step);
                continue;
            }

            var otherStep = await RestoreLifecycleStep(
                LifecycleOperationId.FromStorage(row.OperationId),
                row.Key,
                row.State,
                row.Revision,
                LifecycleDeliverySequence.FromStorage(
                    row.DeliverySequence),
                row.OwnerRevision,
                row.BlockedReason,
                row.UpdatedAt,
                cancellation);
            database.Attach(otherStep);
            database.Entry(otherStep)
                .Property(value => value.Revision)
                .OriginalValue = row.Revision;
            steps.Add(otherStep);
        }
        var blocked = steps.Any(value =>
            value.State == LifecycleStepState.Blocked);
        var complete = steps.All(value =>
            value.State == LifecycleStepState.Complete);
        await UpdateLifecycleOperationState(
            operation,
            blocked,
            complete,
            now,
            cancellation);

        Domain.Addresses.TenantAddressBinding? tenantAddress = null;
        Domain.Workspaces.WorkspaceAddressBinding? workspaceAddress = null;
        if (complete
            && operation.Kind == LifecycleOperationKind.Delete)
        {
            if (targetState.Tenant is not null)
            {
                var targetTenantId = targetState.TenantId;
                var addressRow = await database.TenantAddressBindings
                    .AsNoTracking()
                    .Where(value =>
                        EF.Property<string>(value, "_tenantId")
                            == targetTenantId)
                    .Select(value => new
                    {
                        value.Id,
                        TenantId = EF.Property<string>(
                            value,
                            "_tenantId"),
                        Authority = EF.Property<string>(
                            value,
                            "_authority"),
                        PathPrefix = EF.Property<string>(
                            value,
                            "_pathPrefix"),
                        value.BindingGeneration,
                        value.IsActive,
                        value.CreatedAt,
                        value.UpdatedAt
                    })
                    .SingleAsync(queryCancellation);
                tenantAddress = await RestoreTenantAddressBinding(
                    addressRow.Id,
                    TenantId.FromStorage(addressRow.TenantId),
                    ExternalAuthority.FromStorage(addressRow.Authority),
                    TenantPathPrefix.FromStorage(addressRow.PathPrefix),
                    addressRow.BindingGeneration,
                    addressRow.IsActive,
                    addressRow.CreatedAt,
                    addressRow.UpdatedAt,
                    cancellation);
                database.Attach(tenantAddress);
            }
            else
            {
                var targetWorkspaceId = targetState.WorkspaceId;
                var addressRow = await database.WorkspaceAddressBindings
                    .AsNoTracking()
                    .Where(value =>
                        EF.Property<string>(value, "_workspaceId")
                            == targetWorkspaceId)
                    .Select(value => new
                    {
                        value.Id,
                        TenantId = EF.Property<string>(
                            value,
                            "_tenantId"),
                        WorkspaceId = EF.Property<string>(
                            value,
                            "_workspaceId"),
                        WorkspaceAddress = EF.Property<string>(
                            value,
                            "_workspaceAddress"),
                        value.BindingGeneration,
                        value.IsActive,
                        value.CreatedAt,
                        value.UpdatedAt
                    })
                    .SingleAsync(queryCancellation);
                workspaceAddress = await RestoreWorkspaceAddressBinding(
                    addressRow.Id,
                    TenantId.FromStorage(addressRow.TenantId),
                    WorkspaceId.FromStorage(addressRow.WorkspaceId),
                    WorkspaceAddress.FromStorage(
                        addressRow.WorkspaceAddress),
                    addressRow.BindingGeneration,
                    addressRow.IsActive,
                    addressRow.CreatedAt,
                    addressRow.UpdatedAt,
                    cancellation);
                database.Attach(workspaceAddress);
            }
        }

        var accepted = await ApplyTargetProgress(
            database,
            targetState,
            operation,
            steps,
            tenantAddress,
            workspaceAddress,
            eventSequence,
            now,
            cancellation);
        AddIdempotencyRecord(
            database,
            command.Actor,
            AcknowledgeOperation,
            command.IdempotencyKey,
            command.RequestDigest,
            targetState.ResourceKind,
            targetState.ResourceId,
            operationId,
            accepted.ResourceRevision,
            accepted.Lifecycle,
            accepted.ProvisioningGeneration,
            step.Revision.Value,
            step.State,
            eventSequence.Value,
            now);
        AddAuditOutboxEntry(
            database,
            operation.RequestActor,
            command.Actor,
            AcknowledgeOperation,
            eventSequence,
            targetState.ResourceKind,
            targetState.TenantId,
            targetState.WorkspaceId,
            targetState.ResourceId,
            accepted.ResourceRevision,
            command.IdempotencyKey,
            auditCorrelation,
            now);
        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return new LifecycleAcknowledgementResult.Accepted(
            CreateLifecycleAcknowledgement(step, accepted));
    }
}
