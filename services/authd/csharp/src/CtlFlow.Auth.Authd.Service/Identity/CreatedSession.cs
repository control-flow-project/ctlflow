namespace CtlFlow.Auth.Authd.Service.Identity;

internal sealed record CreatedSession(
    SessionCredential Credential,
    DateTimeOffset ExpiresAt)
    : IDisposable
{
    public void Dispose() => Credential.Dispose();
}
