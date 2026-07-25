using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record UpdateTenantCommand(
    TenantId TenantId,
    TenantDisplayName DisplayName,
    ResourceEventSequence ExpectedResourceVersion,
    RequestActor Actor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest);
