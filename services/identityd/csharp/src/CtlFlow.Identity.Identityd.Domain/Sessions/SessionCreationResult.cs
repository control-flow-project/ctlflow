namespace CtlFlow.Identity.Identityd.Domain.Sessions;

public abstract record SessionCreationResult
{
    private SessionCreationResult()
    {
    }

    public sealed record Created(SessionCreation Creation)
        : SessionCreationResult;

    public sealed record Unauthenticated : SessionCreationResult;
}
