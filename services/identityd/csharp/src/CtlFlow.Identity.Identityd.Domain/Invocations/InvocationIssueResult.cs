namespace CtlFlow.Identity.Identityd.Domain.Invocations;

public abstract record InvocationIssueResult
{
    private InvocationIssueResult()
    {
    }

    public sealed record Issued(InvocationClaims Claims)
        : InvocationIssueResult;

    public sealed record Unauthenticated : InvocationIssueResult;

    public sealed record NotFound : InvocationIssueResult;
}
