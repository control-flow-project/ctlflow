using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public sealed record ConfigurationId
{
    private ConfigurationId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ConfigurationId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new ConfigurationId(
                ValidateIdentifier(value, "Configuration ID")));
    }

    public static ConfigurationId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "configuration ID"));
}
