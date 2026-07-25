using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Db.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleStates;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static partial class TenantResources
{
    internal static IReadOnlyList<ResourceWatchEvent<TenantResource>>
        CreateTenantEventResources(
            IReadOnlyList<ResourceEvent> events,
            IReadOnlyList<Tenant> tenants,
            IReadOnlyList<TenantAddressBinding> addresses,
            IReadOnlyList<TenantInitialAdministrator> administrators,
            IReadOnlyList<TenantBaselinePackage> packages,
            IReadOnlyList<LifecycleOperation> operations,
            IReadOnlyList<ResourceEventCondition> conditions)
    {
        if (events.Count == 0)
        {
            return [];
        }

        return events
            .Select(resourceEvent =>
            {
                var tenant = tenants.Single(value =>
                    value.Id.Value == resourceEvent.TenantId);
                var operation = resourceEvent.CurrentOperationId is null
                    ? null
                    : operations.Single(value =>
                        value.Id.Value
                        == resourceEvent.CurrentOperationId);
                var eventConditions = conditions
                    .Where(value =>
                        value.EventSequence
                        == resourceEvent.EventSequence)
                    .Select(CreateEventCondition)
                    .ToArray();
                if (resourceEvent.CurrentOperationId is not null
                    && eventConditions.Length == 0)
                {
                    throw new InvalidOperationException(
                        "A Tenant event with a current lifecycle operation "
                        + "has no condition snapshot");
                }

                var resource = new TenantResource(
                    tenant.Id,
                    TenantDisplayName.FromStorage(
                        resourceEvent.DisplayName),
                    addresses.Single(value =>
                        value.TenantId == tenant.Id).Authority,
                    addresses.Single(value =>
                        value.TenantId == tenant.Id).PathPrefix,
                    CreateEventAdministrator(
                        administrators.Single(value =>
                            value.TenantId == tenant.Id.Value)),
                    packages
                        .Where(value =>
                            value.TenantId == tenant.Id.Value)
                        .Select(CreateEventPackage)
                        .ToArray(),
                    FromStorage(resourceEvent.LifecycleState),
                    TenantRevision.FromStorage(
                        resourceEvent.ResourceRevision),
                    TenantProvisioningGeneration.FromStorage(
                        resourceEvent.ProvisioningGeneration),
                    operation?.Id,
                    operation?.Kind,
                    eventConditions,
                    ResourceEventSequence.FromStorage(
                        resourceEvent.EventSequence),
                    tenant.CreatedAt,
                    UtcInstant.FromStorage(
                        resourceEvent.EventAtUnixMilliseconds));
                return new ResourceWatchEvent<TenantResource>(
                    ResourceEventSequence.FromStorage(
                        resourceEvent.EventSequence),
                    (ResourceEventKind)resourceEvent.EventKind,
                    resource);
            })
            .ToArray();
    }

    private static InitialAdministratorIntent CreateEventAdministrator(
        TenantInitialAdministrator value) =>
        new(
            AdministratorDisplayName.FromStorage(value.DisplayName),
            LoginIdentifier.FromStorage(value.LoginIdentifier),
            value.ProviderId is null
                ? null
                : new IdentityLinkIntent(
                    IdentityProviderId.FromStorage(value.ProviderId),
                    ProviderSubject.FromStorage(value.ProviderSubject!)));

    private static BaselinePackageIntent CreateEventPackage(
        TenantBaselinePackage value) =>
        new(
            PackageId.FromStorage(value.PackageId),
            PackageVersion.FromStorage(value.PackageVersion));

    private static LifecycleCondition CreateEventCondition(
        ResourceEventCondition value) =>
        new(
            (LifecycleStepKey)value.StepKey,
            (LifecycleStepState)value.StepState,
            value.BlockedReason is null
                ? null
                : BlockedReason.FromStorage(value.BlockedReason),
            value.OwnerRevision is null
                ? null
                : LifecycleOwnerRevision.FromStorage(
                    value.OwnerRevision.Value),
            UtcInstant.FromStorage(value.UpdatedAtUnixMilliseconds));
}
