using System.Data;
using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourcePages;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.WorkspaceAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<ResourceListResult<WorkspaceResource>>
        ListWorkspaceResources(
            IDbContextFactory<TenantDbContext> databaseContexts,
            TenantId tenantId,
            PageSize pageSize,
            PageToken? pageToken,
            RequestActor actor,
            RequestDigest visibility,
            PageCursorLifetime cursorLifetime,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "list_workspace_resources");
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var page = await ReadWorkspacePage(
                databaseContexts,
                tenantId,
                pageSize,
                pageToken,
                actor,
                visibility,
                now,
                cancellation);
            if (page is null)
            {
                return new ResourceListResult<WorkspaceResource>
                    .ExpiredPageToken();
            }

            var items = page.Items;
            if (!page.HasMore)
            {
                return new ResourceListResult<WorkspaceResource>.Page(
                    new ResourcePage<WorkspaceResource>(
                        items,
                        null,
                        page.Snapshot));
            }

            var nextToken = await StorePageCursor(
                databaseContexts,
                2,
                actor,
                visibility,
                tenantId.Value,
                items[^1].WorkspaceId.Value,
                page.Snapshot,
                cursorLifetime,
                now,
                cancellation);
            if (nextToken is not null)
            {
                return new ResourceListResult<WorkspaceResource>.Page(
                    new ResourcePage<WorkspaceResource>(
                        items,
                        nextToken,
                        page.Snapshot));
            }

            if (pageToken is not null)
            {
                return new ResourceListResult<WorkspaceResource>
                    .ExpiredPageToken();
            }
        }

        return new ResourceListResult<WorkspaceResource>.ExpiredPageToken();
    }

    private static async Task<WorkspacePageRead?> ReadWorkspacePage(
        IDbContextFactory<TenantDbContext> databaseContexts,
        TenantId tenantId,
        PageSize pageSize,
        PageToken? pageToken,
        RequestActor actor,
        RequestDigest visibility,
        UtcInstant now,
        CancellationToken cancellation)
    {
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var snapshotValue = await database.ResourceEventSequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => value.CurrentSequence)
            .SingleAsync(queryCancellation);
        var snapshot = ResourceEventCursor.FromStorage(snapshotValue);
        var lastWorkspaceId = string.Empty;

        if (pageToken is not null)
        {
            var token = pageToken.Value;
            var cursor = await database.PageCursors
                .AsNoTracking()
                .Where(value => value.PageToken == token)
                .Select(value => new
                {
                    value.ResourceKind,
                    value.RequestActor,
                    value.VisibilityHash,
                    value.TenantFilter,
                    value.LastResourceId,
                    value.SnapshotSequence,
                    value.ExpiresAtUnixMilliseconds
                })
                .SingleOrDefaultAsync(queryCancellation);
            if (cursor is null
                || cursor.ResourceKind != 2
                || cursor.RequestActor != actor.Value
                || cursor.VisibilityHash != visibility.Value
                || cursor.TenantFilter != tenantId.Value
                || cursor.ExpiresAtUnixMilliseconds <= now.UnixMilliseconds
                || cursor.SnapshotSequence != snapshot.Value)
            {
                await transaction.RollbackAsync(cancellation);
                return null;
            }

            lastWorkspaceId = cursor.LastResourceId;
            snapshot = ResourceEventCursor.FromStorage(
                cursor.SnapshotSequence);
        }

        var requested = pageSize.Value;
        var parentId = tenantId.Value;
        var queryLimit = requested + 1;
        var rows = await database.Workspaces
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_tenantId") == parentId
                && string.Compare(
                    EF.Property<string>(value, "_id"),
                    lastWorkspaceId)
                    > 0)
            .OrderBy(value => EF.Property<string>(value, "_id"))
            .Take(queryLimit)
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
            .ToListAsync(queryCancellation);
        var hasMore = rows.Count > requested;
        var selectedRows = rows.Take(requested).ToArray();
        IReadOnlyList<WorkspaceResource> resources = [];
        if (selectedRows.Length > 0)
        {
            var rangeStartWorkspaceId = selectedRows[0].Id;
            var rangeEndWorkspaceId = selectedRows[^1].Id;
            var addressRows = await database.WorkspaceAddressBindings
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_tenantId") == parentId
                    && string.Compare(
                        EF.Property<string>(value, "_workspaceId"),
                        rangeStartWorkspaceId) >= 0
                    && string.Compare(
                        EF.Property<string>(value, "_workspaceId"),
                        rangeEndWorkspaceId) <= 0)
                .Select(value => new
                {
                    value.Id,
                    TenantId = EF.Property<string>(value, "_tenantId"),
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
                .ToListAsync(queryCancellation);
            var membershipRows = await database.WorkspaceInitialMemberships
                .AsNoTracking()
                .Where(value =>
                    string.Compare(
                        value.WorkspaceId,
                        rangeStartWorkspaceId) >= 0
                    && string.Compare(
                        value.WorkspaceId,
                        rangeEndWorkspaceId) <= 0)
                .OrderBy(value => value.UserId)
                .Select(value => new
                {
                    value.WorkspaceId,
                    value.UserId,
                    value.Standing
                })
                .ToListAsync(queryCancellation);
            var packageRows = await database.WorkspaceBaselinePackages
                .AsNoTracking()
                .Where(value =>
                    string.Compare(
                        value.WorkspaceId,
                        rangeStartWorkspaceId) >= 0
                    && string.Compare(
                        value.WorkspaceId,
                        rangeEndWorkspaceId) <= 0)
                .OrderBy(value => value.PackageId)
                .ThenBy(value => value.PackageVersion)
                .Select(value => new
                {
                    value.WorkspaceId,
                    value.PackageId,
                    value.PackageVersion
                })
                .ToListAsync(queryCancellation);
            var operationRows = await database.LifecycleOperations
                .AsNoTracking()
                .Where(value =>
                    EF.Property<int>(value, "TargetKind") == 2
                    && value.State != LifecycleOperationState.Complete
                    && EF.Property<string>(value, "_tenantId") == parentId
                    && string.Compare(
                        EF.Property<string>(value, "_workspaceId"),
                        rangeStartWorkspaceId) >= 0
                    && string.Compare(
                        EF.Property<string>(value, "_workspaceId"),
                        rangeEndWorkspaceId) <= 0)
                .Select(value => new
                {
                    OperationId = EF.Property<string>(
                        value,
                        "_operationId"),
                    TargetKind = EF.Property<int>(value, "TargetKind"),
                    TenantId = EF.Property<string>(value, "_tenantId"),
                    WorkspaceId = EF.Property<string?>(
                        value,
                        "_workspaceId"),
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
                .ToListAsync(queryCancellation);
            var stepRows = await database.LifecycleSteps
                .AsNoTracking()
                .Where(step =>
                    step.State != LifecycleStepState.Complete
                    && database.LifecycleOperations.Any(operation =>
                        EF.Property<int>(operation, "TargetKind") == 2
                        && operation.State
                            != LifecycleOperationState.Complete
                        && EF.Property<string>(
                            operation,
                            "_tenantId") == parentId
                        && string.Compare(
                            EF.Property<string>(
                                operation,
                                "_workspaceId"),
                            rangeStartWorkspaceId) >= 0
                        && string.Compare(
                            EF.Property<string>(
                                operation,
                                "_workspaceId"),
                            rangeEndWorkspaceId) <= 0
                        && EF.Property<string>(
                            operation,
                            "_operationId")
                            == EF.Property<string>(
                                step,
                                "_operationId")))
                .OrderBy(value => value.Key)
                .Select(value => new
                {
                    OperationId = EF.Property<string>(
                        value,
                        "_operationId"),
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

            var selected = new List<Workspace>(selectedRows.Length);
            foreach (var row in selectedRows)
            {
                selected.Add(await RestoreWorkspace(
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

            var steps = new List<LifecycleStep>(stepRows.Count);
            foreach (var row in stepRows)
            {
                steps.Add(await RestoreLifecycleStep(
                    LifecycleOperationId.FromStorage(row.OperationId),
                    row.Key,
                    row.State,
                    row.Revision,
                    LifecycleDeliverySequence.FromStorage(
                        row.DeliverySequence),
                    row.OwnerRevision,
                    row.BlockedReason,
                    row.UpdatedAt,
                    cancellation));
            }

            resources = CreateWorkspaceResources(
                selected,
                addresses,
                memberships,
                packages,
                operations,
                steps);
        }

        await transaction.CommitAsync(cancellation);
        return new WorkspacePageRead(resources, hasMore, snapshot);
    }

    private sealed record WorkspacePageRead(
        IReadOnlyList<WorkspaceResource> Items,
        bool HasMore,
        ResourceEventCursor Snapshot);
}
