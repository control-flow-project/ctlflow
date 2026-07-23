namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantRevision
{
    private TenantRevision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static TenantRevision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException("Stored Tenant revision must be positive");
        }

        return new TenantRevision(value);
    }
}
