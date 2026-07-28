namespace CtlFlow.Configuration.Configd.Db.Custody;

using CtlFlow.Configuration.Configd.Db.Content;

public static partial class SecretCustody
{
    public static ValueTask<SecretMaterialLease> CreateSecretMaterial(
        ReadOnlyMemory<byte> material,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (material.Length is < 1 or > 65_536)
        {
            throw material.Length > 65_536
                ? new ContentLimitExceededException()
                : new ArgumentException(
                    "Secret material cannot be empty",
                    nameof(material));
        }

        return ValueTask.FromResult(
            new SecretMaterialLease(material.ToArray()));
    }
}
