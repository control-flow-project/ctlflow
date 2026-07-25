namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public abstract record ResourceLookupResult<T>
{
    private ResourceLookupResult()
    {
    }

    public sealed record Found(T Resource) : ResourceLookupResult<T>;

    public sealed record NotFound : ResourceLookupResult<T>;
}
