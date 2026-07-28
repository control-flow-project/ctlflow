using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record SecretVersionId
{
    private SecretVersionId(string value) => Value = value;

    public string Value { get; }

    public static SecretVersionId Parse(string value) =>
        new(ValidateIdentifier(value, "Secret version ID"));

    public static SecretVersionId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "secret version ID"));
}
