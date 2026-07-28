using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record ConfigurationId
{
    private ConfigurationId(string value) => Value = value;

    public string Value { get; }

    public static ConfigurationId Parse(string value) =>
        new(ValidateIdentifier(value, "Configuration ID"));

    public static ConfigurationId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "configuration ID"));
}
