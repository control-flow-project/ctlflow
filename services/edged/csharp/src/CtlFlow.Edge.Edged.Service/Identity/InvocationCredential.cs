namespace CtlFlow.Edge.Edged.Service.Identity;

internal sealed class InvocationCredential(
    string material,
    DateTimeOffset expiresAt)
{
    internal DateTimeOffset ExpiresAt { get; } = expiresAt;

    internal string ReadForApplicationAuthorization() => material;

    public override string ToString() => "[REDACTED]";
}
