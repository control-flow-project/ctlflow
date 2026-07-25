using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Addresses.TenantAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    public static async Task<ResourceLookupResult<TenantResource>>
        QueryTenantResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            TenantId tenantId,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "query_tenant_resource");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var id = tenantId.Value;
        var tenantRow = await database.Tenants
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_id") == id)
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
            return new ResourceLookupResult<TenantResource>.NotFound();
        }

        var addressRows = await database.TenantAddressBindings
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_tenantId") == id)
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
            .Where(value => value.TenantId == id)
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
            .Where(value => value.TenantId == id)
            .OrderBy(value => value.PackageId)
            .ThenBy(value => value.PackageVersion)
            .Select(value => new
            {
                value.TenantId,
                value.PackageId,
                value.PackageVersion
            })
            .ToListAsync(queryCancellation);
        var currentOperationId = tenantRow.CurrentOperationId;
        var operationRows = await database.LifecycleOperations
            .AsNoTracking()
            .Where(value =>
                EF.Property<int>(value, "TargetKind") == 1
                && EF.Property<string>(value, "_tenantId") == id
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
        var addresses = new List<TenantAddressBinding>(addressRows.Count);
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

        var resource = CreateTenantResources(
            [tenant],
            addresses,
            administrators,
            packages,
            operations,
            steps)[0];
        return new ResourceLookupResult<TenantResource>.Found(resource);
    }
}
