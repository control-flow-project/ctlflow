using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.WorkspaceAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<ResourceLookupResult<WorkspaceResource>>
        QueryWorkspaceResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            WorkspaceId workspaceId,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "query_workspace_resource");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var id = workspaceId.Value;
        var workspaceRow = await database.Workspaces
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_id") == id)
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
            return new ResourceLookupResult<WorkspaceResource>.NotFound();
        }

        var tenantId = workspaceRow.TenantId;
        var addressRows = await database.WorkspaceAddressBindings
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_tenantId") == tenantId
                && EF.Property<string>(value, "_workspaceId") == id)
            .Select(value => new
            {
                value.Id,
                TenantId = EF.Property<string>(value, "_tenantId"),
                WorkspaceId = EF.Property<string>(value, "_workspaceId"),
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
            .Where(value => value.WorkspaceId == id)
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
            .Where(value => value.WorkspaceId == id)
            .OrderBy(value => value.PackageId)
            .ThenBy(value => value.PackageVersion)
            .Select(value => new
            {
                value.WorkspaceId,
                value.PackageId,
                value.PackageVersion
            })
            .ToListAsync(queryCancellation);
        var currentOperationId = workspaceRow.CurrentOperationId;
        var operationRows = await database.LifecycleOperations
            .AsNoTracking()
            .Where(value =>
                EF.Property<int>(value, "TargetKind") == 2
                && EF.Property<string>(value, "_tenantId") == tenantId
                && EF.Property<string>(value, "_workspaceId") == id
                && EF.Property<string>(value, "_operationId")
                    == currentOperationId)
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
            .ToListAsync(queryCancellation);
        var stepOperationId = operationRows.Count == 1
            ? operationRows[0].OperationId
            : null;
        var stepRows = await database.LifecycleSteps
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_operationId")
                    == stepOperationId
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
        var addresses = new List<WorkspaceAddressBinding>(addressRows.Count);
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
        var operations = new List<LifecycleOperation>(operationRows.Count);
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
                LifecycleDeliverySequence.FromStorage(row.DeliverySequence),
                row.OwnerRevision,
                row.BlockedReason,
                row.UpdatedAt,
                cancellation));
        }

        var resource = CreateWorkspaceResources(
            [workspace],
            addresses,
            memberships,
            packages,
            operations,
            steps)[0];
        return new ResourceLookupResult<WorkspaceResource>.Found(resource);
    }
}
