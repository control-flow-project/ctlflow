namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public static partial class Secrets
{
    public static ValueTask<Secret> RestoreSecret(
        SecretMetadata metadata,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (metadata.UpdatedAt.Value < metadata.CreatedAt.Value)
        {
            throw new InvalidOperationException(
                "Stored secret timestamps are inconsistent");
        }

        return ValueTask.FromResult(new Secret(
            metadata.Id,
            metadata.Binding,
            metadata.CurrentVersionId,
            metadata.Revision,
            metadata.CreatedAt,
            metadata.UpdatedAt));
    }
}
