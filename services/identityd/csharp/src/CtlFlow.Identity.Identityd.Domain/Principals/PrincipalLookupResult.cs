namespace CtlFlow.Identity.Identityd.Domain.Principals;

public abstract record PrincipalLookupResult
{
    private PrincipalLookupResult()
    {
    }

    public sealed record Found(PrincipalFacts Facts) : PrincipalLookupResult;

    public sealed record NotFound : PrincipalLookupResult;
}
