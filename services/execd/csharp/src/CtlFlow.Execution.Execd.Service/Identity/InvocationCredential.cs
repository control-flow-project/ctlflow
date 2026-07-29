namespace CtlFlow.Execution.Execd.Service.Identity;

internal sealed class InvocationCredential(
    string material,
    DateTimeOffset expiresAt)
{
    internal DateTimeOffset ExpiresAt { get; } = expiresAt;

    internal string ReadForKubernetesProjection() => material;

    public override string ToString() => "[REDACTED]";
}
