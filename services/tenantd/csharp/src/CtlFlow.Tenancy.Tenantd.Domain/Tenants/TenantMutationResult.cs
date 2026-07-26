using CtlFlow.Tenancy.Tenantd.Domain.Auditing;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public abstract record TenantMutationResult
{
    private TenantMutationResult()
    {
    }

    public sealed record Changed(
        Tenant Tenant,
        AuditIntent Audit) : TenantMutationResult;

    public sealed record Current(TenantDetails Tenant) : TenantMutationResult;

    public sealed record NotFound : TenantMutationResult;

    public sealed record AlreadyExists : TenantMutationResult;

    public sealed record FailedPrecondition : TenantMutationResult;

    public sealed record RevisionMismatch : TenantMutationResult;
}
