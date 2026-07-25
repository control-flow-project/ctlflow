using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleWork
{
    internal static async Task<IReadOnlyList<LifecycleWorkItem>>
        LoadLifecycleWorkItems(
            IDbContextFactory<TenantDbContext> databaseContexts,
            IReadOnlyList<LifecycleWorkSource> sources,
            CancellationToken cancellation)
    {
        if (sources.Count == 0)
        {
            return [];
        }

        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var firstDeliverySequence = sources.Min(
            value => value.DeliverySequence.Value);
        var lastDeliverySequence = sources.Max(
            value => value.DeliverySequence.Value);
        var stepKey = sources[0].StepKey;
        var operationRows = stepKey switch
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
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
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
                .Select(value => new LifecycleOperationRow(
                        value.OperationId,
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind"),
                        EF.Property<string>(
                            value.Operation,
                            "_tenantId"),
                        EF.Property<string?>(
                            value.Operation,
                            "_workspaceId"),
                        value.Operation.Kind,
                        value.Operation.DesiredLifecycle,
                        value.Operation.ProvisioningGeneration,
                        value.Operation.State,
                        value.Operation.RequestActor,
                        value.Operation.IdempotencyKey,
                        value.Operation.RequestDigest,
                        value.Operation.CreatedAt,
                        value.Operation.UpdatedAt))
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
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
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
                .Select(value => new LifecycleOperationRow(
                        value.OperationId,
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind"),
                        EF.Property<string>(
                            value.Operation,
                            "_tenantId"),
                        EF.Property<string?>(
                            value.Operation,
                            "_workspaceId"),
                        value.Operation.Kind,
                        value.Operation.DesiredLifecycle,
                        value.Operation.ProvisioningGeneration,
                        value.Operation.State,
                        value.Operation.RequestActor,
                        value.Operation.IdempotencyKey,
                        value.Operation.RequestDigest,
                        value.Operation.CreatedAt,
                        value.Operation.UpdatedAt))
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
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
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
                .Select(value => new LifecycleOperationRow(
                        value.OperationId,
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind"),
                        EF.Property<string>(
                            value.Operation,
                            "_tenantId"),
                        EF.Property<string?>(
                            value.Operation,
                            "_workspaceId"),
                        value.Operation.Kind,
                        value.Operation.DesiredLifecycle,
                        value.Operation.ProvisioningGeneration,
                        value.Operation.State,
                        value.Operation.RequestActor,
                        value.Operation.IdempotencyKey,
                        value.Operation.RequestDigest,
                        value.Operation.CreatedAt,
                        value.Operation.UpdatedAt))
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
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
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
                .Select(value => new LifecycleOperationRow(
                        value.OperationId,
                        EF.Property<int>(
                            value.Operation,
                            "TargetKind"),
                        EF.Property<string>(
                            value.Operation,
                            "_tenantId"),
                        EF.Property<string?>(
                            value.Operation,
                            "_workspaceId"),
                        value.Operation.Kind,
                        value.Operation.DesiredLifecycle,
                        value.Operation.ProvisioningGeneration,
                        value.Operation.State,
                        value.Operation.RequestActor,
                        value.Operation.IdempotencyKey,
                        value.Operation.RequestDigest,
                        value.Operation.CreatedAt,
                        value.Operation.UpdatedAt))
                .ToListAsync(queryCancellation),
            _ => throw new InvalidOperationException(
                "Lifecycle step key is invalid")
        };
        var operations = new List<LifecycleOperation>();
        foreach (var row in operationRows
            .GroupBy(value => value.OperationId, StringComparer.Ordinal)
            .Select(value => value.First()))
        {
            var target = RestoreLifecycleTarget(
                row.TargetKind,
                row.TenantId,
                row.WorkspaceId);
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
        IReadOnlyList<TenantInitialAdministrator> administrators = [];
        IReadOnlyList<WorkspaceInitialMembership> memberships = [];
        if (stepKey == LifecycleStepKey.Identity)
        {
            var administratorRows = await database.LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Identity
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
                    && value.Operation.Kind
                        == LifecycleOperationKind.Provision
                    && EF.Property<int>(
                        value.Operation,
                        "TargetKind") == 1)
                .Join(
                    database.TenantInitialAdministrators.AsNoTracking(),
                    delivery => EF.Property<string>(
                        delivery.Operation,
                        "_tenantId"),
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
            administrators = administratorRows
                .Select(value => new TenantInitialAdministrator(
                    value.TenantId,
                    value.DisplayName,
                    value.LoginIdentifier,
                    value.ProviderId,
                    value.ProviderSubject))
                .ToArray();
            var membershipRows = await database.LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Identity
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
                    && value.Operation.Kind
                        == LifecycleOperationKind.Provision
                    && EF.Property<int>(
                        value.Operation,
                        "TargetKind") == 2
                    && database.Tenants.Any(tenant =>
                        EF.Property<string>(tenant, "_id")
                            == EF.Property<string>(
                                value.Operation,
                                "_tenantId")
                        && tenant.Lifecycle == LifecycleState.Active))
                .Join(
                    database.WorkspaceInitialMemberships.AsNoTracking(),
                    delivery => EF.Property<string?>(
                        delivery.Operation,
                        "_workspaceId"),
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
            memberships = membershipRows
                .Select(value => new WorkspaceInitialMembership(
                    value.WorkspaceId,
                    value.UserId,
                    value.Standing))
                .ToArray();
        }

        IReadOnlyList<TenantBaselinePackage> tenantPackages = [];
        IReadOnlyList<WorkspaceBaselinePackage> workspacePackages = [];
        if (stepKey == LifecycleStepKey.Packages)
        {
            var tenantPackageRows = await database.LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Packages
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
                    && value.Operation.Kind
                        == LifecycleOperationKind.Provision
                    && EF.Property<int>(
                        value.Operation,
                        "TargetKind") == 1)
                .Join(
                    database.TenantBaselinePackages.AsNoTracking(),
                    delivery => EF.Property<string>(
                        delivery.Operation,
                        "_tenantId"),
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
            tenantPackages = tenantPackageRows
                .Select(value => new TenantBaselinePackage(
                    value.TenantId,
                    value.PackageId,
                    value.PackageVersion))
                .ToArray();
            var workspacePackageRows = await database.LifecycleDeliveries
                .AsNoTracking()
                .Where(value =>
                    value.StepKey == LifecycleStepKey.Packages
                    && value.Step.State != LifecycleStepState.Complete
                    && value.DeliverySequence == EF.Property<long>(
                        value.Step,
                        "_deliverySequence")
                    && value.DeliverySequence >= firstDeliverySequence
                    && value.DeliverySequence <= lastDeliverySequence
                    && value.Operation.Kind
                        == LifecycleOperationKind.Provision
                    && EF.Property<int>(
                        value.Operation,
                        "TargetKind") == 2
                    && database.Tenants.Any(tenant =>
                        EF.Property<string>(tenant, "_id")
                            == EF.Property<string>(
                                value.Operation,
                                "_tenantId")
                        && tenant.Lifecycle == LifecycleState.Active))
                .Join(
                    database.WorkspaceBaselinePackages.AsNoTracking(),
                    delivery => EF.Property<string?>(
                        delivery.Operation,
                        "_workspaceId"),
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
            workspacePackages = workspacePackageRows
                .Select(value => new WorkspaceBaselinePackage(
                    value.WorkspaceId,
                    value.PackageId,
                    value.PackageVersion))
                .ToArray();
        }

        return sources
            .Select(source =>
            {
                var operation = operations.Single(value =>
                    value.Id == source.OperationId);
                return new LifecycleWorkItem(
                    source.DeliverySequence,
                    operation.Target,
                    operation.Id,
                    operation.ProvisioningGeneration,
                    operation.Kind,
                    operation.DesiredLifecycle,
                    source.StepKey,
                    source.StepState,
                    source.StepRevision,
                    source.BlockedReason,
                    CreateProvisioningIntent(
                        operation,
                        source.StepKey,
                        administrators,
                        tenantPackages,
                        memberships,
                        workspacePackages));
            })
            .ToArray();
    }

    private static LifecycleProvisioningIntent CreateProvisioningIntent(
        LifecycleOperation operation,
        LifecycleStepKey stepKey,
        IReadOnlyList<TenantInitialAdministrator> administrators,
        IReadOnlyList<TenantBaselinePackage> tenantPackages,
        IReadOnlyList<WorkspaceInitialMembership> memberships,
        IReadOnlyList<WorkspaceBaselinePackage> workspacePackages)
    {
        if (operation.Kind != LifecycleOperationKind.Provision)
        {
            return new LifecycleProvisioningIntent.None();
        }

        if (stepKey == LifecycleStepKey.Identity)
        {
            return operation.Target switch
            {
                LifecycleTarget.Tenant tenant =>
                    new LifecycleProvisioningIntent.Identity(
                        CreateAdministrator(
                            administrators.Single(value =>
                                value.TenantId == tenant.TenantId.Value)),
                        []),
                LifecycleTarget.Workspace workspace =>
                    new LifecycleProvisioningIntent.Identity(
                        null,
                        memberships
                            .Where(value =>
                                value.WorkspaceId
                                == workspace.WorkspaceId.Value)
                            .Select(CreateMembership)
                            .ToArray()),
                _ => throw new InvalidOperationException(
                    "Lifecycle target is invalid")
            };
        }

        if (stepKey == LifecycleStepKey.Packages)
        {
            return operation.Target switch
            {
                LifecycleTarget.Tenant tenant =>
                    new LifecycleProvisioningIntent.Packages(
                        tenantPackages
                            .Where(value =>
                                value.TenantId == tenant.TenantId.Value)
                            .Select(CreatePackage)
                            .ToArray()),
                LifecycleTarget.Workspace workspace =>
                    new LifecycleProvisioningIntent.Packages(
                        workspacePackages
                            .Where(value =>
                                value.WorkspaceId
                                == workspace.WorkspaceId.Value)
                            .Select(CreatePackage)
                            .ToArray()),
                _ => throw new InvalidOperationException(
                    "Lifecycle target is invalid")
            };
        }

        return new LifecycleProvisioningIntent.None();
    }

    private static InitialAdministratorIntent CreateAdministrator(
        TenantInitialAdministrator value)
    {
        return new InitialAdministratorIntent(
            AdministratorDisplayName.FromStorage(value.DisplayName),
            LoginIdentifier.FromStorage(value.LoginIdentifier),
            value.ProviderId is null
                ? null
                : new IdentityLinkIntent(
                    IdentityProviderId.FromStorage(value.ProviderId),
                    ProviderSubject.FromStorage(value.ProviderSubject!)));
    }

    private static InitialWorkspaceMembershipIntent CreateMembership(
        WorkspaceInitialMembership value) =>
        new(
            UserId.FromStorage(value.UserId),
            value.Standing switch
            {
                1 => MembershipStanding.Admin,
                2 => MembershipStanding.Member,
                _ => throw new InvalidOperationException(
                    "Stored membership standing is invalid")
            });

    private static BaselinePackageIntent CreatePackage(
        TenantBaselinePackage value) =>
        new(
            PackageId.FromStorage(value.PackageId),
            PackageVersion.FromStorage(value.PackageVersion));

    private static BaselinePackageIntent CreatePackage(
        WorkspaceBaselinePackage value) =>
        new(
            PackageId.FromStorage(value.PackageId),
            PackageVersion.FromStorage(value.PackageVersion));
}
