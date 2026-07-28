namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public abstract record AppLookupResult
{
    private AppLookupResult()
    {
    }

    public sealed record Found(AppDetails App) : AppLookupResult;

    public sealed record NotFound : AppLookupResult;
}
