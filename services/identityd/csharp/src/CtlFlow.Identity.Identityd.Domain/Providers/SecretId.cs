using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public sealed record SecretId
{
    private SecretId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<SecretId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new SecretId(ValidateIdentifier(value, "Secret ID")));
    }

    public static SecretId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "secret ID"));
}
