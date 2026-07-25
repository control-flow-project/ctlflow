namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantRevision
{
    private TenantRevision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static TenantRevision Initial() => new(1);

    public static ValueTask<TenantRevision> Parse(
        ulong value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value is 0 or > long.MaxValue)
        {
            throw new ArgumentException(
                "Tenant revision must be a positive signed 64-bit value",
                nameof(value));
        }

        return ValueTask.FromResult(new TenantRevision((long)value));
    }

    public TenantRevision Next() => new(checked(Value + 1));

    public static TenantRevision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException("Stored Tenant revision must be positive");
        }

        return new TenantRevision(value);
    }
}
