namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public abstract record ResourceListResult<T>
{
    private ResourceListResult()
    {
    }

    public sealed record Page(ResourcePage<T> Value)
        : ResourceListResult<T>;

    public sealed record ExpiredPageToken : ResourceListResult<T>;
}
