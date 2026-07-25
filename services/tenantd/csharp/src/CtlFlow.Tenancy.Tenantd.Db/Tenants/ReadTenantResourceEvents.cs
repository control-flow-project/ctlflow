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
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Addresses.TenantAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    private const int ResourceWatchBatchSize = 32;

    public static async Task<ResourceWatchReadResult<TenantResource>>
        ReadTenantResourceEvents(
            IDbContextFactory<TenantDbContext> databaseContexts,
            ResourceEventCursor after,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "read_tenant_resource_events");
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
            return new ResourceWatchReadResult<TenantResource>
                .InvalidCursor();
        }

        if (after.Value < state.RetainedFromSequence - 1)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceWatchReadResult<TenantResource>
                .ExpiredCursor();
        }

        var afterSequence = after.Value;
        var queryLimit = ResourceWatchBatchSize;
        var rows = await database.ResourceEvents
            .AsNoTracking()
            .Where(value =>
                value.ResourceKind == 1
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
        IReadOnlyList<ResourceWatchEvent<TenantResource>> events = [];
        if (rows.Count > 0)
        {
            var lastEventSequence = rows[^1].EventSequence;
            var tenantRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 1
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.Tenants.AsNoTracking(),
                    resourceEvent => resourceEvent.TenantId,
                    tenant => EF.Property<string>(tenant, "_id"),
                    (_, tenant) => new
                    {
                        Id = EF.Property<string>(tenant, "_id"),
                        tenant.DisplayName,
                        tenant.Lifecycle,
                        tenant.Revision,
                        tenant.ProvisioningGeneration,
                        CurrentOperationId = EF.Property<string?>(
                            tenant,
                            "_currentOperationId"),
                        tenant.LastEventSequence,
                        tenant.CreatedAt,
                        tenant.UpdatedAt
                    })
                .Distinct()
                .ToListAsync(queryCancellation);
            var addressRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 1
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.TenantAddressBindings.AsNoTracking(),
                    resourceEvent => resourceEvent.TenantId,
                    address => EF.Property<string>(
                        address,
                        "_tenantId"),
                    (_, address) => new
                    {
                        address.Id,
                        TenantId = EF.Property<string>(
                            address,
                            "_tenantId"),
                        Authority = EF.Property<string>(
                            address,
                            "_authority"),
                        PathPrefix = EF.Property<string>(
                            address,
                            "_pathPrefix"),
                        address.BindingGeneration,
                        address.IsActive,
                        address.CreatedAt,
                        address.UpdatedAt
                    })
                .Distinct()
                .ToListAsync(queryCancellation);
            var administratorRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 1
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.TenantInitialAdministrators.AsNoTracking(),
                    resourceEvent => resourceEvent.TenantId,
                    administrator => administrator.TenantId,
                    (_, administrator) => new
                    {
                        administrator.TenantId,
                        administrator.DisplayName,
                        administrator.LoginIdentifier,
                        administrator.ProviderId,
                        administrator.ProviderSubject
                    })
                .Distinct()
                .ToListAsync(queryCancellation);
            var packageRows = await database.ResourceEvents
                .AsNoTracking()
                .Where(value =>
                    value.ResourceKind == 1
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.TenantBaselinePackages.AsNoTracking(),
                    resourceEvent => resourceEvent.TenantId,
                    package => package.TenantId,
                    (_, package) => new
                    {
                        package.TenantId,
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
                    value.ResourceKind == 1
                    && value.CurrentOperationId != null
                    && value.EventSequence > afterSequence
                    && value.EventSequence <= lastEventSequence)
                .Join(
                    database.LifecycleOperations
                        .AsNoTracking()
                        .Where(operation =>
                            EF.Property<int>(
                                operation,
                                "TargetKind") == 1),
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
                    value.ResourceKind == 1
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

            var tenants = new List<Tenant>(tenantRows.Count);
            foreach (var row in tenantRows)
            {
                tenants.Add(await RestoreTenant(
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

            events = CreateTenantEventResources(
                resourceEvents,
                tenants,
                addresses,
                administrators,
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
        return new ResourceWatchReadResult<TenantResource>.Batch(
            events,
            current);
    }
}
