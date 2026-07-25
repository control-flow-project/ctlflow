using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantResource(
    TenantId TenantId,
    TenantDisplayName DisplayName,
    ExternalAuthority Authority,
    TenantPathPrefix PathPrefix,
    InitialAdministratorIntent InitialAdministrator,
    IReadOnlyList<BaselinePackageIntent> BaselinePackages,
    LifecycleState Lifecycle,
    TenantRevision Revision,
    TenantProvisioningGeneration ProvisioningGeneration,
    LifecycleOperationId? CurrentOperationId,
    LifecycleOperationKind? CurrentOperationKind,
    IReadOnlyList<LifecycleCondition> Conditions,
    ResourceEventSequence ResourceVersion,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
