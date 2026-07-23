using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Caching;

public readonly record struct CacheExpiry
{
    private CacheExpiry(DateTimeOffset value)
    {
        Value = value;
    }

    public DateTimeOffset Value { get; }

    public static CacheExpiry Calculate(
        UtcInstant currentTime,
        CacheLifetime lifetime) =>
        new(currentTime.Value.Add(lifetime.Value));
}
