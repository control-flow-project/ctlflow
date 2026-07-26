namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public abstract record SessionRevocationResult
{
    private SessionRevocationResult()
    {
    }

    public sealed record Found(SessionRevocation Revocation)
        : SessionRevocationResult;

    public sealed record Unauthenticated : SessionRevocationResult;
}
