namespace CtlFlow.Auth.Authd.Service.State;

internal sealed record CreatedAuthenticationAttempt(
    string BrowserNonce)
{
    public override string ToString() => "[REDACTED]";
}
