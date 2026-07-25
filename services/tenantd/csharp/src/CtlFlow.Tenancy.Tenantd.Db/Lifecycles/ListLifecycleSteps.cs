using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleWork;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public static partial class Lifecycles
{
    public static async Task<ListLifecycleStepsResult> ListLifecycleSteps(
        IDbContextFactory<TenantDbContext> databaseContexts,
        LifecycleStepKey stepKey,
        RequestActor actor,
        PageSize pageSize,
        PageToken? pageToken,
        PageCursorLifetime cursorLifetime,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "list_lifecycle_steps");
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var page = await ReadLifecyclePage(
                databaseContexts,
                stepKey,
                actor,
                pageSize,
                pageToken,
                now,
                cancellation);
            if (page is null)
            {
                return new ListLifecycleStepsResult.ExpiredPageToken();
            }

            if (!page.HasMore)
            {
                return new ListLifecycleStepsResult.Page(
                    new LifecycleStepPage(
                        page.Items,
                        null,
                        page.Snapshot));
            }

            var nextToken = await StoreLifecyclePageCursor(
                databaseContexts,
                stepKey,
                actor,
                page.Items[^1].DeliverySequence.Value,
                page.Snapshot,
                cursorLifetime,
                now,
                cancellation);
            if (nextToken is not null)
            {
                return new ListLifecycleStepsResult.Page(
                    new LifecycleStepPage(
                        page.Items,
                        nextToken,
                        page.Snapshot));
            }

            if (pageToken is not null)
            {
                return new ListLifecycleStepsResult.ExpiredPageToken();
            }
        }

        return new ListLifecycleStepsResult.ExpiredPageToken();
    }

    private static async Task<LifecyclePageRead?> ReadLifecyclePage(
        IDbContextFactory<TenantDbContext> databaseContexts,
        LifecycleStepKey stepKey,
        RequestActor actor,
        PageSize pageSize,
        PageToken? pageToken,
        UtcInstant now,
        CancellationToken cancellation)
    {
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var snapshotValue = await database.LifecycleDeliverySequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => value.CurrentSequence)
            .SingleAsync(queryCancellation);
        var snapshot = LifecycleDeliveryCursor.FromStorage(snapshotValue);
        var lastDeliverySequence = 0L;

        if (pageToken is not null)
        {
            var token = pageToken.Value;
            var cursor = await database.LifecyclePageCursors
                .AsNoTracking()
                .Where(value => value.PageToken == token)
                .Select(value => new
                {
                    value.StepKey,
                    value.RequestActor,
                    value.LastDeliverySequence,
                    value.SnapshotSequence,
                    value.ExpiresAtUnixMilliseconds
                })
                .SingleOrDefaultAsync(queryCancellation);
            if (cursor is null
                || cursor.StepKey != (int)stepKey
                || cursor.RequestActor != actor.Value
                || cursor.ExpiresAtUnixMilliseconds <= now.UnixMilliseconds
                || cursor.SnapshotSequence != snapshot.Value)
            {
                await transaction.RollbackAsync(cancellation);
                return null;
            }

            lastDeliverySequence = cursor.LastDeliverySequence;
            snapshot = LifecycleDeliveryCursor.FromStorage(
                cursor.SnapshotSequence);
        }

        var requested = pageSize.Value;
        var snapshotSequence = snapshot.Value;
        var queryLimit = requested + 1;
        var rows = stepKey switch
        {
            LifecycleStepKey.Identity => await database.LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Identity
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence > lastDeliverySequence
                    && value.DeliverySequence <= snapshotSequence
                    && (
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind") == 1
                        || database.Tenants.Any(tenant =>
                            EF.Property<string>(tenant, "_id")
                                == EF.Property<string>(
                                    value.Operation,
                                    "_tenantId")
                            && tenant.Lifecycle
                                == LifecycleState.Active)))
                .OrderBy(value => value.DeliverySequence)
                .Take(queryLimit)
                .Select(value => new LifecycleStepRow(
                    value.OperationId,
                    value.Step.Key,
                    value.Step.State,
                    value.Step.Revision,
                    value.DeliverySequence,
                    value.Step.OwnerRevision,
                    value.Step.BlockedReason,
                    value.Step.UpdatedAt))
                .ToListAsync(queryCancellation),
            LifecycleStepKey.Configuration => await database
                .LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Configuration
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence > lastDeliverySequence
                    && value.DeliverySequence <= snapshotSequence
                    && (
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind") == 1
                        || database.Tenants.Any(tenant =>
                            EF.Property<string>(tenant, "_id")
                                == EF.Property<string>(
                                    value.Operation,
                                    "_tenantId")
                            && tenant.Lifecycle
                                == LifecycleState.Active)))
                .OrderBy(value => value.DeliverySequence)
                .Take(queryLimit)
                .Select(value => new LifecycleStepRow(
                    value.OperationId,
                    value.Step.Key,
                    value.Step.State,
                    value.Step.Revision,
                    value.DeliverySequence,
                    value.Step.OwnerRevision,
                    value.Step.BlockedReason,
                    value.Step.UpdatedAt))
                .ToListAsync(queryCancellation),
            LifecycleStepKey.Execution => await database.LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Execution
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence > lastDeliverySequence
                    && value.DeliverySequence <= snapshotSequence
                    && (
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind") == 1
                        || database.Tenants.Any(tenant =>
                            EF.Property<string>(tenant, "_id")
                                == EF.Property<string>(
                                    value.Operation,
                                    "_tenantId")
                            && tenant.Lifecycle
                                == LifecycleState.Active)))
                .OrderBy(value => value.DeliverySequence)
                .Take(queryLimit)
                .Select(value => new LifecycleStepRow(
                    value.OperationId,
                    value.Step.Key,
                    value.Step.State,
                    value.Step.Revision,
                    value.DeliverySequence,
                    value.Step.OwnerRevision,
                    value.Step.BlockedReason,
                    value.Step.UpdatedAt))
                .ToListAsync(queryCancellation),
            LifecycleStepKey.Packages => await database.LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Packages
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence > lastDeliverySequence
                    && value.DeliverySequence <= snapshotSequence
                    && (
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind") == 1
                        || database.Tenants.Any(tenant =>
                            EF.Property<string>(tenant, "_id")
                                == EF.Property<string>(
                                    value.Operation,
                                    "_tenantId")
                            && tenant.Lifecycle
                                == LifecycleState.Active)))
                .OrderBy(value => value.DeliverySequence)
                .Take(queryLimit)
                .Select(value => new LifecycleStepRow(
                    value.OperationId,
                    value.Step.Key,
                    value.Step.State,
                    value.Step.Revision,
                    value.DeliverySequence,
                    value.Step.OwnerRevision,
                    value.Step.BlockedReason,
                    value.Step.UpdatedAt))
                .ToListAsync(queryCancellation),
            _ => throw new InvalidOperationException(
                "Lifecycle step key is invalid")
        };
        var hasMore = rows.Count > requested;
        var selected = rows.Take(requested).ToArray();
        var items = await LoadLifecycleWorkItems(
            databaseContexts,
            selected
                .Select(value => new LifecycleWorkSource(
                    LifecycleOperationId.FromStorage(value.OperationId),
                    LifecycleDeliverySequence.FromStorage(
                        value.DeliverySequence),
                    value.Key,
                    value.State,
                    value.Revision,
                    value.BlockedReason))
                .ToArray(),
            cancellation);
        await transaction.CommitAsync(cancellation);
        return new LifecyclePageRead(items, hasMore, snapshot);
    }

    private sealed record LifecyclePageRead(
        IReadOnlyList<LifecycleWorkItem> Items,
        bool HasMore,
        LifecycleDeliveryCursor Snapshot);
}
