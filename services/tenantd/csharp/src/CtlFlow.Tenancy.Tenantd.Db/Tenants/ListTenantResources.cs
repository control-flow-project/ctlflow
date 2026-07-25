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
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Addresses.TenantAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<ResourceListResult<TenantResource>>
        ListTenantResources(
            IDbContextFactory<TenantDbContext> databaseContexts,
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
            "list_tenant_resources");
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var page = await ReadTenantPage(
                databaseContexts,
                pageSize,
                pageToken,
                actor,
                visibility,
                now,
                cancellation);
            if (page is null)
            {
                return new ResourceListResult<TenantResource>
                    .ExpiredPageToken();
            }

            var items = page.Items;
            if (!page.HasMore)
            {
                return new ResourceListResult<TenantResource>.Page(
                    new ResourcePage<TenantResource>(
                        items,
                        null,
                        page.Snapshot));
            }

            var nextToken = await StorePageCursor(
                databaseContexts,
                1,
                actor,
                visibility,
                null,
                items[^1].TenantId.Value,
                page.Snapshot,
                cursorLifetime,
                now,
                cancellation);
            if (nextToken is not null)
            {
                return new ResourceListResult<TenantResource>.Page(
                    new ResourcePage<TenantResource>(
                        items,
                        nextToken,
                        page.Snapshot));
            }

            if (pageToken is not null)
            {
                return new ResourceListResult<TenantResource>
                    .ExpiredPageToken();
            }
        }

        return new ResourceListResult<TenantResource>.ExpiredPageToken();
    }

    private static async Task<TenantPageRead?> ReadTenantPage(
        IDbContextFactory<TenantDbContext> databaseContexts,
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
        var lastTenantId = string.Empty;

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
                || cursor.ResourceKind != 1
                || cursor.RequestActor != actor.Value
                || cursor.VisibilityHash != visibility.Value
                || cursor.TenantFilter is not null
                || cursor.ExpiresAtUnixMilliseconds <= now.UnixMilliseconds
                || cursor.SnapshotSequence != snapshot.Value)
            {
                await transaction.RollbackAsync(cancellation);
                return null;
            }

            lastTenantId = cursor.LastResourceId;
            snapshot = ResourceEventCursor.FromStorage(
                cursor.SnapshotSequence);
        }

        var requested = pageSize.Value;
        var queryLimit = requested + 1;
        var rows = await database.Tenants
            .AsNoTracking()
            .Where(value => string.Compare(
                    EF.Property<string>(value, "_id"),
                    lastTenantId)
                > 0)
            .OrderBy(value => EF.Property<string>(value, "_id"))
            .Take(queryLimit)
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
            .ToListAsync(queryCancellation);
        var hasMore = rows.Count > requested;
        var selectedRows = rows.Take(requested).ToArray();
        IReadOnlyList<TenantResource> resources = [];
        if (selectedRows.Length > 0)
        {
            var rangeStartTenantId = selectedRows[0].Id;
            var rangeEndTenantId = selectedRows[^1].Id;
            var addressRows = await database.TenantAddressBindings
                .AsNoTracking()
                .Where(value =>
                    string.Compare(
                        EF.Property<string>(value, "_tenantId"),
                        rangeStartTenantId) >= 0
                    && string.Compare(
                        EF.Property<string>(value, "_tenantId"),
                        rangeEndTenantId) <= 0)
                .Select(value => new
                {
                    value.Id,
                    TenantId = EF.Property<string>(value, "_tenantId"),
                    Authority = EF.Property<string>(value, "_authority"),
                    PathPrefix = EF.Property<string>(value, "_pathPrefix"),
                    value.BindingGeneration,
                    value.IsActive,
                    value.CreatedAt,
                    value.UpdatedAt
                })
                .ToListAsync(queryCancellation);
            var administratorRows = await database.TenantInitialAdministrators
                .AsNoTracking()
                .Where(value =>
                    string.Compare(value.TenantId, rangeStartTenantId) >= 0
                    && string.Compare(value.TenantId, rangeEndTenantId) <= 0)
                .Select(value => new
                {
                    value.TenantId,
                    value.DisplayName,
                    value.LoginIdentifier,
                    value.ProviderId,
                    value.ProviderSubject
                })
                .ToListAsync(queryCancellation);
            var packageRows = await database.TenantBaselinePackages
                .AsNoTracking()
                .Where(value =>
                    string.Compare(value.TenantId, rangeStartTenantId) >= 0
                    && string.Compare(value.TenantId, rangeEndTenantId) <= 0)
                .OrderBy(value => value.PackageId)
                .ThenBy(value => value.PackageVersion)
                .Select(value => new
                {
                    value.TenantId,
                    value.PackageId,
                    value.PackageVersion
                })
                .ToListAsync(queryCancellation);
            var operationRows = await database.LifecycleOperations
                .AsNoTracking()
                .Where(value =>
                    EF.Property<int>(value, "TargetKind") == 1
                    && value.State != LifecycleOperationState.Complete
                    && string.Compare(
                        EF.Property<string>(value, "_tenantId"),
                        rangeStartTenantId) >= 0
                    && string.Compare(
                        EF.Property<string>(value, "_tenantId"),
                        rangeEndTenantId) <= 0)
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
                        EF.Property<int>(operation, "TargetKind") == 1
                        && operation.State
                            != LifecycleOperationState.Complete
                        && string.Compare(
                            EF.Property<string>(
                                operation,
                                "_tenantId"),
                            rangeStartTenantId) >= 0
                        && string.Compare(
                            EF.Property<string>(
                                operation,
                                "_tenantId"),
                            rangeEndTenantId) <= 0
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

            var selected = new List<Tenant>(selectedRows.Length);
            foreach (var row in selectedRows)
            {
                selected.Add(await RestoreTenant(
                    TenantId.FromStorage(row.Id),
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

            var addresses = new List<TenantAddressBinding>(
                addressRows.Count);
            foreach (var row in addressRows)
            {
                addresses.Add(await RestoreTenantAddressBinding(
                    row.Id,
                    TenantId.FromStorage(row.TenantId),
                    ExternalAuthority.FromStorage(row.Authority),
                    TenantPathPrefix.FromStorage(row.PathPrefix),
                    row.BindingGeneration,
                    row.IsActive,
                    row.CreatedAt,
                    row.UpdatedAt,
                    cancellation));
            }

            var administrators = administratorRows
                .Select(row => new TenantInitialAdministrator(
                    row.TenantId,
                    row.DisplayName,
                    row.LoginIdentifier,
                    row.ProviderId,
                    row.ProviderSubject))
                .ToArray();
            var packages = packageRows
                .Select(row => new TenantBaselinePackage(
                    row.TenantId,
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

            resources = CreateTenantResources(
                selected,
                addresses,
                administrators,
                packages,
                operations,
                steps);
        }

        await transaction.CommitAsync(cancellation);
        return new TenantPageRead(resources, hasMore, snapshot);
    }

    private sealed record TenantPageRead(
        IReadOnlyList<TenantResource> Items,
        bool HasMore,
        ResourceEventCursor Snapshot);
}
