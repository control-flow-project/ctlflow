namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantDisplayName
{
    private const int MaximumLength = 200;

    private TenantDisplayName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static TenantDisplayName FromStorage(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaximumLength)
        {
            throw new InvalidOperationException("Stored Tenant display name is invalid");
        }

        return new TenantDisplayName(value);
    }

    public override string ToString() => Value;
}
