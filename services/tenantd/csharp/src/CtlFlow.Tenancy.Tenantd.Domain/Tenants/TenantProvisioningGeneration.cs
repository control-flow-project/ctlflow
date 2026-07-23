namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantProvisioningGeneration
{
    private TenantProvisioningGeneration(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static TenantProvisioningGeneration FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored Tenant provisioning generation must be positive");
        }

        return new TenantProvisioningGeneration(value);
    }
}
