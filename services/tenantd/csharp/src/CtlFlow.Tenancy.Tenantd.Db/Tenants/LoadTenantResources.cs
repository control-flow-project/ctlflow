using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static partial class TenantResources
{
    internal static IReadOnlyList<TenantResource> CreateTenantResources(
            IReadOnlyList<Tenant> tenants,
            IReadOnlyList<TenantAddressBinding> addresses,
            IReadOnlyList<TenantInitialAdministrator> administrators,
            IReadOnlyList<TenantBaselinePackage> packages,
            IReadOnlyList<LifecycleOperation> operations,
            IReadOnlyList<LifecycleStep> steps)
    {
        if (tenants.Count == 0)
        {
            return [];
        }

        return tenants
            .Select(tenant => CreateTenantResource(
                tenant,
                addresses.Single(value =>
                    value.TenantId == tenant.Id),
                administrators.Single(value =>
                    value.TenantId == tenant.Id.Value),
                packages.Where(value =>
                    value.TenantId == tenant.Id.Value),
                operations.SingleOrDefault(value =>
                    value.Id == tenant.CurrentOperationId),
                steps.Where(value =>
                    value.OperationId == tenant.CurrentOperationId)))
            .ToArray();
    }

    private static TenantResource CreateTenantResource(
        Tenant tenant,
        Domain.Addresses.TenantAddressBinding address,
        TenantInitialAdministrator administrator,
        IEnumerable<TenantBaselinePackage> packages,
        LifecycleOperation? operation,
        IEnumerable<LifecycleStep> steps)
    {
        return new TenantResource(
            tenant.Id,
            tenant.DisplayName,
            address.Authority,
            address.PathPrefix,
            CreateInitialAdministrator(administrator),
            packages
                .Select(value => new BaselinePackageIntent(
                    PackageId.FromStorage(value.PackageId),
                    PackageVersion.FromStorage(value.PackageVersion)))
                .ToArray(),
            tenant.Lifecycle,
            tenant.Revision,
            tenant.ProvisioningGeneration,
            tenant.CurrentOperationId,
            operation?.Kind,
            steps
                .Select(value => new LifecycleCondition(
                    value.Key,
                    value.State,
                    value.BlockedReason,
                    value.OwnerRevision,
                    value.UpdatedAt))
                .ToArray(),
            tenant.LastEventSequence,
            tenant.CreatedAt,
            tenant.UpdatedAt);
    }

    private static InitialAdministratorIntent CreateInitialAdministrator(
        TenantInitialAdministrator administrator)
    {
        var identityLink = administrator.ProviderId is null
            ? null
            : new IdentityLinkIntent(
                IdentityProviderId.FromStorage(administrator.ProviderId),
                ProviderSubject.FromStorage(administrator.ProviderSubject!));

        return new InitialAdministratorIntent(
            AdministratorDisplayName.FromStorage(administrator.DisplayName),
            LoginIdentifier.FromStorage(administrator.LoginIdentifier),
            identityLink);
    }
}
