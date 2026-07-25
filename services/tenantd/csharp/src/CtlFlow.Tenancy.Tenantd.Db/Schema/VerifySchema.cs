using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        IDbContextFactory<TenantDbContext> databaseContexts,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "verify_schema");
        var ledger = await VerifyMigrationLedger(databaseContexts, cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;

        await database.Tenants
            .AsNoTracking()
            .OrderBy(tenant => EF.Property<string>(tenant, "_id"))
            .Select(tenant => new
            {
                Id = EF.Property<string>(tenant, "_id"),
                tenant.DisplayName,
                tenant.Lifecycle,
                tenant.Revision,
                tenant.ProvisioningGeneration,
                tenant.CreatedAt,
                tenant.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.TenantAddressBindings
            .AsNoTracking()
            .OrderBy(address => address.Id)
            .Select(address => new
            {
                address.Id,
                TenantId = EF.Property<string>(address, "_tenantId"),
                Authority = EF.Property<string>(address, "_authority"),
                PathPrefix = EF.Property<string>(address, "_pathPrefix"),
                address.BindingGeneration,
                address.IsActive,
                address.CreatedAt,
                address.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Workspaces
            .AsNoTracking()
            .OrderBy(workspace => EF.Property<string>(workspace, "_id"))
            .Select(workspace => new
            {
                Id = EF.Property<string>(workspace, "_id"),
                TenantId = EF.Property<string>(workspace, "_tenantId"),
                workspace.DisplayName,
                workspace.Lifecycle,
                workspace.Revision,
                workspace.ProvisioningGeneration,
                workspace.CreatedAt,
                workspace.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkspaceAddressBindings
            .AsNoTracking()
            .OrderBy(address => address.Id)
            .Select(address => new
            {
                address.Id,
                TenantId = EF.Property<string>(address, "_tenantId"),
                WorkspaceId = EF.Property<string>(address, "_workspaceId"),
                WorkspaceAddress = EF.Property<string>(address, "_workspaceAddress"),
                address.BindingGeneration,
                address.IsActive,
                address.CreatedAt,
                address.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.LifecycleOperations
            .AsNoTracking()
            .OrderBy(operation => EF.Property<string>(
                operation,
                "_operationId"))
            .Select(operation => new
            {
                OperationId = EF.Property<string>(
                    operation,
                    "_operationId"),
                TargetKind = EF.Property<int>(operation, "TargetKind"),
                TenantId = EF.Property<string>(operation, "_tenantId"),
                WorkspaceId = EF.Property<string?>(
                    operation,
                    "_workspaceId"),
                operation.Kind,
                operation.DesiredLifecycle,
                operation.ProvisioningGeneration,
                operation.State,
                operation.RequestActor,
                operation.IdempotencyKey,
                operation.RequestDigest,
                operation.CreatedAt,
                operation.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.LifecycleSteps
            .AsNoTracking()
            .OrderBy(step => EF.Property<string>(step, "_operationId"))
            .ThenBy(step => step.Key)
            .Select(step => new
            {
                OperationId = EF.Property<string>(step, "_operationId"),
                step.Key,
                step.State,
                step.Revision,
                DeliverySequence = EF.Property<long>(
                    step,
                    "_deliverySequence"),
                step.OwnerRevision,
                step.BlockedReason,
                step.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.LifecycleDeliveries
            .AsNoTracking()
            .OrderBy(delivery => delivery.DeliverySequence)
            .Select(delivery => new
            {
                delivery.DeliverySequence,
                delivery.OperationId,
                delivery.StepKey,
                delivery.StepRevision,
                delivery.CreatedAtUnixMilliseconds
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.LifecyclePageCursors
            .AsNoTracking()
            .OrderBy(cursor => cursor.PageToken)
            .Select(cursor => new
            {
                cursor.PageToken,
                cursor.StepKey,
                cursor.RequestActor,
                cursor.LastDeliverySequence,
                cursor.SnapshotSequence,
                cursor.ExpiresAtUnixMilliseconds
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.LifecycleDeliverySequences
            .AsNoTracking()
            .OrderBy(sequence => sequence.SequenceId)
            .Select(sequence => new
            {
                sequence.SequenceId,
                sequence.CurrentSequence
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.ResourceEventSequences
            .AsNoTracking()
            .OrderBy(sequence => sequence.SequenceId)
            .Select(sequence => new
            {
                sequence.SequenceId,
                sequence.CurrentSequence,
                sequence.RetainedFromSequence
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.ResourceEvents
            .AsNoTracking()
            .OrderBy(resourceEvent => resourceEvent.EventSequence)
            .Select(resourceEvent => new
            {
                resourceEvent.EventSequence,
                resourceEvent.ResourceKind,
                resourceEvent.EventKind,
                resourceEvent.TenantId,
                resourceEvent.WorkspaceId,
                resourceEvent.DisplayName,
                resourceEvent.LifecycleState,
                resourceEvent.ResourceRevision,
                resourceEvent.ProvisioningGeneration,
                resourceEvent.CurrentOperationId,
                resourceEvent.EventAtUnixMilliseconds
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.ResourceEventConditions
            .AsNoTracking()
            .OrderBy(condition => condition.EventSequence)
            .ThenBy(condition => condition.StepKey)
            .Select(condition => new
            {
                condition.EventSequence,
                condition.StepKey,
                condition.StepState,
                condition.OwnerRevision,
                condition.BlockedReason,
                condition.UpdatedAtUnixMilliseconds
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PageCursors
            .AsNoTracking()
            .OrderBy(cursor => cursor.PageToken)
            .Select(cursor => new
            {
                cursor.PageToken,
                cursor.ResourceKind,
                cursor.RequestActor,
                cursor.VisibilityHash,
                cursor.TenantFilter,
                cursor.LastResourceId,
                cursor.SnapshotSequence,
                cursor.ExpiresAtUnixMilliseconds
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.IdempotencyRecords
            .AsNoTracking()
            .OrderBy(record => record.RecordId)
            .Select(record => new
            {
                record.RecordId,
                record.RequestActor,
                record.OperationName,
                record.IdempotencyKey,
                record.RequestHash,
                record.ResourceKind,
                record.ResourceId,
                record.LifecycleOperationId,
                record.ResultResourceRevision,
                record.ResultLifecycleState,
                record.ResultProvisioningGeneration,
                record.ResultStepRevision,
                record.ResultStepState,
                record.ResultEventSequence,
                record.CreatedAtUnixMilliseconds
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.AuditOutbox
            .AsNoTracking()
            .OrderBy(entry => entry.SourceSequence)
            .Select(entry => new
            {
                entry.OutboxId,
                entry.SourceEventId,
                entry.SourceSequence,
                entry.OperatorSubject,
                entry.ImmediateCaller,
                entry.OperationName,
                entry.ResourceKind,
                entry.TenantId,
                entry.WorkspaceId,
                entry.ResourceId,
                entry.ResourceRevision,
                entry.IdempotencyKey,
                entry.OccurredAtUnixMilliseconds,
                entry.TraceId,
                entry.SpanId,
                entry.DeliveryState,
                entry.DeliveryAttempts,
                entry.Revision,
                entry.AvailableAtUnixMilliseconds,
                entry.LeaseId,
                entry.LeaseExpiresAtUnixMilliseconds,
                entry.FailureCode
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.AuditOutboxStates
            .AsNoTracking()
            .OrderBy(state => state.StateId)
            .Select(state => new
            {
                state.StateId,
                state.MaximumPending,
                state.PendingCount,
                state.PermanentlyBlocked,
                state.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.TenantInitialAdministrators
            .AsNoTracking()
            .OrderBy(administrator => administrator.TenantId)
            .Select(administrator => new
            {
                administrator.TenantId,
                administrator.DisplayName,
                administrator.LoginIdentifier,
                administrator.ProviderId,
                administrator.ProviderSubject
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.TenantBaselinePackages
            .AsNoTracking()
            .OrderBy(package => package.TenantId)
            .ThenBy(package => package.PackageId)
            .ThenBy(package => package.PackageVersion)
            .Select(package => new
            {
                package.TenantId,
                package.PackageId,
                package.PackageVersion
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkspaceInitialMemberships
            .AsNoTracking()
            .OrderBy(membership => membership.WorkspaceId)
            .ThenBy(membership => membership.UserId)
            .Select(membership => new
            {
                membership.WorkspaceId,
                membership.UserId,
                membership.Standing
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkspaceBaselinePackages
            .AsNoTracking()
            .OrderBy(package => package.WorkspaceId)
            .ThenBy(package => package.PackageId)
            .ThenBy(package => package.PackageVersion)
            .Select(package => new
            {
                package.WorkspaceId,
                package.PackageId,
                package.PackageVersion
            })
            .Take(1)
            .ToListAsync(queryCancellation);

        return SchemaCompatibility.Compatible;
    }
}
