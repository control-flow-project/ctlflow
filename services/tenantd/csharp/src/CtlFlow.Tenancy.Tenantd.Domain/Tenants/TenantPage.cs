namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantPage(
    IReadOnlyList<TenantDetails> Tenants,
    TenantId? NextAfterTenantId);
