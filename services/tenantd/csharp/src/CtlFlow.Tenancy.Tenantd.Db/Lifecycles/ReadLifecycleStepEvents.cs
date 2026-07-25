using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleWork;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public static partial class Lifecycles
{
    private const int LifecycleWatchBatchSize = 32;

    public static async Task<LifecycleWatchReadResult>
        ReadLifecycleStepEvents(
            IDbContextFactory<TenantDbContext> databaseContexts,
            LifecycleStepKey stepKey,
            LifecycleDeliveryCursor after,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "read_lifecycle_step_events");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var currentValue = await database.LifecycleDeliverySequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => value.CurrentSequence)
            .SingleAsync(queryCancellation);
        var current = LifecycleDeliveryCursor.FromStorage(currentValue);
        if (after.Value > current.Value)
        {
            return new LifecycleWatchReadResult.InvalidCursor();
        }

        var afterSequence = after.Value;
        var queryLimit = LifecycleWatchBatchSize;
        var rows = stepKey switch
        {
            LifecycleStepKey.Identity => await database
                .LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Identity
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence > afterSequence
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
                .Select(value => new LifecycleDeliveryRow(
                    value.DeliverySequence,
                    value.OperationId,
                    value.StepRevision))
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
                    && value.DeliverySequence > afterSequence
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
                .Select(value => new LifecycleDeliveryRow(
                    value.DeliverySequence,
                    value.OperationId,
                    value.StepRevision))
                .ToListAsync(queryCancellation),
            LifecycleStepKey.Execution => await database
                .LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Execution
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence > afterSequence
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
                .Select(value => new LifecycleDeliveryRow(
                    value.DeliverySequence,
                    value.OperationId,
                    value.StepRevision))
                .ToListAsync(queryCancellation),
            LifecycleStepKey.Packages => await database
                .LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Packages
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence > afterSequence
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
                .Select(value => new LifecycleDeliveryRow(
                    value.DeliverySequence,
                    value.OperationId,
                    value.StepRevision))
                .ToListAsync(queryCancellation),
            _ => throw new InvalidOperationException(
                "Lifecycle step key is invalid")
        };
        var sources = rows
            .Select(value => new LifecycleWorkSource(
                LifecycleOperationId.FromStorage(value.OperationId),
                LifecycleDeliverySequence.FromStorage(
                    value.DeliverySequence),
                stepKey,
                LifecycleStepState.Pending,
                LifecycleStepRevision.FromStorage(value.StepRevision),
                null))
            .ToArray();
        return new LifecycleWatchReadResult.Batch(
            await LoadLifecycleWorkItems(
                databaseContexts,
                sources,
                cancellation),
            current);
    }
}
