using System.Data;
using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Db.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.WorkspaceAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    private const int ResourceWatchBatchSize = 32;

    public static async Task<ResourceWatchReadResult<WorkspaceResource>>
        ReadWorkspaceResourceEvents(
            IDbContextFactory<TenantDbContext> databaseContexts,
            TenantId tenantId,
            ResourceEventCursor after,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "read_workspace_resource_events");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var state = await database.ResourceEventSequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => new
            {
                value.CurrentSequence,
                value.RetainedFromSequence
            })
            .SingleAsync(queryCancellation);
        if (after.Value > state.CurrentSequence)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceWatchReadResult<WorkspaceResource>
                .InvalidCursor();
        }

        if (after.Value < state.RetainedFromSequence - 1)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceWatchReadResult<WorkspaceResource>
                .ExpiredCursor();
        }

        var parentId = tenantId.Value;
        var afterSequence = after.Value;
        var queryLimit = ResourceWatchBatchSize;
        var rows = await database.ResourceEvents
            .AsNoTracking()
            .Where(value =>
                value.ResourceKind == 2
                && value.TenantId == parentId
                && value.EventSequence > afterSequence)
            .OrderBy(value => value.EventSequence)
            .Take(queryLimit)
            .Select(value => new
            {
                value.EventSequence,
                value.ResourceKind,
                value.EventKind,
                value.TenantId,
                value.WorkspaceId,
                value.DisplayName,
                value.LifecycleState,
                value.ResourceRevision,
                value.ProvisioningGeneration,
                value.CurrentOperationId,
                value.EventAtUnixMilliseconds
            })
            .ToListAsync(queryCancellation);
        IReadOnlyList<ResourceWatchEvent<WorkspaceResource>> events = [];
        if (rows.Count > 0)
        {
            var lastEventSequence = rows[^1].EventSequence;
            var workspaceRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 2
                    && value.TenantId == parentId
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.Workspaces.AsNoTracking(),
                    resourceEvent => resourceEvent.WorkspaceId,
                    workspace => EF.Property<string?>(
                        workspace,
                        "_id"),
                    (_, workspace) => new
                    {
                        Id = EF.Property<string>(workspace, "_id"),
                        TenantId = EF.Property<string>(
                            workspace,
                            "_tenantId"),
                        workspace.DisplayName,
                        workspace.Lifecycle,
                        workspace.Revision,
                        workspace.ProvisioningGeneration,
                        CurrentOperationId = EF.Property<string?>(
                            workspace,
                            "_currentOperationId"),
                        workspace.LastEventSequence,
                        workspace.CreatedAt,
                        workspace.UpdatedAt
                    })
                .Distinct()
                .ToListAsync(queryCancellation);
            var addressRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 2
                    && value.TenantId == parentId
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.WorkspaceAddressBindings.AsNoTracking(),
                    resourceEvent => resourceEvent.WorkspaceId,
                    address => EF.Property<string?>(
                        address,
                        "_workspaceId"),
                    (_, address) => new
                    {
                        address.Id,
                        TenantId = EF.Property<string>(
                            address,
                            "_tenantId"),
                        WorkspaceId = EF.Property<string>(
                            address,
                            "_workspaceId"),
                        WorkspaceAddress = EF.Property<string>(
                            address,
                            "_workspaceAddress"),
                        address.BindingGeneration,
                        address.IsActive,
                        address.CreatedAt,
                        address.UpdatedAt
                    })
                .Distinct()
                .ToListAsync(queryCancellation);
            var membershipRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 2
                    && value.TenantId == parentId
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.WorkspaceInitialMemberships.AsNoTracking(),
                    resourceEvent => resourceEvent.WorkspaceId,
                    membership => (string?)membership.WorkspaceId,
                    (_, membership) => new
                    {
                        membership.WorkspaceId,
                        membership.UserId,
                        membership.Standing
                    })
                .Distinct()
                .OrderBy(value => value.UserId)
                .ToListAsync(queryCancellation);
            var packageRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 2
                    && value.TenantId == parentId
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.WorkspaceBaselinePackages.AsNoTracking(),
                    resourceEvent => resourceEvent.WorkspaceId,
                    package => (string?)package.WorkspaceId,
                    (_, package) => new
                    {
                        package.WorkspaceId,
                        package.PackageId,
                        package.PackageVersion
                    })
                .Distinct()
                .OrderBy(value => value.PackageId)
                .ThenBy(value => value.PackageVersion)
                .ToListAsync(queryCancellation);
            var operationRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 2
                    && value.TenantId == parentId
                    && value.CurrentOperationId != null
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.LifecycleOperations
                        .AsNoTracking()
                        .Where(operation =>
                            EF.Property<int>(
                                operation,
                                "TargetKind") == 2
                            && EF.Property<string>(
                                operation,
                                "_tenantId") == parentId),
                    resourceEvent => resourceEvent.CurrentOperationId,
                    operation => EF.Property<string?>(
                        operation,
                        "_operationId"),
                    (_, operation) => new
                    {
                        OperationId = EF.Property<string>(
                            operation,
                            "_operationId"),
                        TargetKind = EF.Property<int>(
                            operation,
                            "TargetKind"),
                        TenantId = EF.Property<string>(
                            operation,
                            "_tenantId"),
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
                .Distinct()
                .ToListAsync(queryCancellation);
            var conditionQueryLimit = ResourceWatchBatchSize * 4;
            var conditionRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 2
                    && value.TenantId == parentId
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.ResourceEventConditions.AsNoTracking(),
                    resourceEvent => resourceEvent.EventSequence,
                    condition => condition.EventSequence,
                    (resourceEvent, condition) => new
                    {
                        condition.EventSequence,
                        condition.StepKey,
                        condition.StepState,
                        condition.OwnerRevision,
                        condition.BlockedReason,
                        condition.UpdatedAtUnixMilliseconds
                    })
                .OrderBy(value => value.EventSequence)
                .ThenBy(value => value.StepKey)
                .Take(conditionQueryLimit)
                .ToListAsync(queryCancellation);
            var resourceEvents = rows
                .Select(row => new ResourceEvent(
                    row.EventSequence,
                    row.ResourceKind,
                    row.EventKind,
                    row.TenantId,
                    row.WorkspaceId,
                    row.DisplayName,
                    row.LifecycleState,
                    row.ResourceRevision,
                    row.ProvisioningGeneration,
                    row.CurrentOperationId,
                    row.EventAtUnixMilliseconds))
                .ToArray();
            var conditions = conditionRows
                .Select(row => new ResourceEventCondition(
                    row.EventSequence,
                    row.StepKey,
                    row.StepState,
                    row.OwnerRevision,
                    row.BlockedReason,
                    row.UpdatedAtUnixMilliseconds))
                .ToArray();
            var workspaces = new List<Workspace>(workspaceRows.Count);
            foreach (var row in workspaceRows)
            {
                workspaces.Add(await RestoreWorkspace(
                    WorkspaceId.FromStorage(row.Id),
                    TenantId.FromStorage(row.TenantId),
                    row.DisplayName,
                    row.Lifecycle,
                    row.Revision,
                    row.ProvisioningGeneration,
                    row.CurrentOperationId is null
                        ? null
                        : LifecycleOperationId.FromStorage(
                            row.CurrentOperationId),
                    row.LastEventSequence,
                    row.CreatedAt,
                    row.UpdatedAt,
                    cancellation));
            }

            var addresses = new List<WorkspaceAddressBinding>(
                addressRows.Count);
            foreach (var row in addressRows)
            {
                addresses.Add(await RestoreWorkspaceAddressBinding(
                    row.Id,
                    TenantId.FromStorage(row.TenantId),
                    WorkspaceId.FromStorage(row.WorkspaceId),
                    WorkspaceAddress.FromStorage(row.WorkspaceAddress),
                    row.BindingGeneration,
                    row.IsActive,
                    row.CreatedAt,
                    row.UpdatedAt,
                    cancellation));
            }

            var memberships = membershipRows
                .Select(row => new WorkspaceInitialMembership(
                    row.WorkspaceId,
                    row.UserId,
                    row.Standing))
                .ToArray();
            var packages = packageRows
                .Select(row => new WorkspaceBaselinePackage(
                    row.WorkspaceId,
                    row.PackageId,
                    row.PackageVersion))
                .ToArray();
            var operations = new List<LifecycleOperation>(
                operationRows.Count);
            foreach (var row in operationRows)
            {
                LifecycleTarget target = row.TargetKind switch
                {
                    1 => new LifecycleTarget.Tenant(
                        TenantId.FromStorage(row.TenantId)),
                    2 => new LifecycleTarget.Workspace(
                        TenantId.FromStorage(row.TenantId),
                        WorkspaceId.FromStorage(row.WorkspaceId!)),
                    _ => throw new InvalidOperationException(
                        "Stored lifecycle target kind is invalid")
                };
                operations.Add(await RestoreLifecycleOperation(
                    LifecycleOperationId.FromStorage(row.OperationId),
                    target,
                    row.Kind,
                    row.DesiredLifecycle,
                    row.ProvisioningGeneration,
                    row.State,
                    row.RequestActor,
                    row.IdempotencyKey,
                    row.RequestDigest,
                    row.CreatedAt,
                    row.UpdatedAt,
                    cancellation));
            }

            events = CreateWorkspaceEventResources(
                resourceEvents,
                workspaces,
                addresses,
                memberships,
                packages,
                operations,
                conditions);
        }

        var currentValue = await database.ResourceEventSequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => value.CurrentSequence)
            .SingleAsync(queryCancellation);
        var current = ResourceEventCursor.FromStorage(currentValue);
        await transaction.CommitAsync(cancellation);
        return new ResourceWatchReadResult<WorkspaceResource>.Batch(
            events,
            current);
    }
}
