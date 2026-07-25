using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record CreateTenantCommand(
    TenantDisplayName DisplayName,
    ExternalAuthority Authority,
    TenantPathPrefix PathPrefix,
    InitialAdministratorIntent InitialAdministrator,
    IReadOnlyList<BaselinePackageIntent> BaselinePackages,
    RequestActor Actor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest);
