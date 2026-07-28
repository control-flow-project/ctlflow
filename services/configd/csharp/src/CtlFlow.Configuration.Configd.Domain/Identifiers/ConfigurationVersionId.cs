using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record ConfigurationVersionId
{
    private ConfigurationVersionId(string value) => Value = value;

    public string Value { get; }

    public static ConfigurationVersionId Parse(string value) =>
        new(ValidateIdentifier(value, "Configuration version ID"));

    public static ConfigurationVersionId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "configuration version ID"));
}
