using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record SecretId
{
    private SecretId(string value) => Value = value;

    public string Value { get; }

    public static SecretId Parse(string value) =>
        new(ValidateIdentifier(value, "Secret ID"));

    public static SecretId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "secret ID"));
}
