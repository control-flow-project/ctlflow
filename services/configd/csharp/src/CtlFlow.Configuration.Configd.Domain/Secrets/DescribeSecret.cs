namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public static partial class Secrets
{
    public static ValueTask<SecretMetadata> DescribeSecret(
        Secret secret,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new SecretMetadata(
            secret.Id,
            secret.Binding,
            secret.CurrentVersionId,
            secret.Revision,
            secret.CreatedAt,
            secret.UpdatedAt));
    }
}
