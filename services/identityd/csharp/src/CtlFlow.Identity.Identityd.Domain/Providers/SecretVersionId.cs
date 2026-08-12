using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public sealed record SecretVersionId
{
    private SecretVersionId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<SecretVersionId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new SecretVersionId(
                ValidateIdentifier(value, "Secret version ID")));
    }

    public static SecretVersionId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "secret version ID"));
}
