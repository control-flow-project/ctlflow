using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public sealed record ConfigurationVersionId
{
    private ConfigurationVersionId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ConfigurationVersionId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new ConfigurationVersionId(
                ValidateIdentifier(value, "Configuration version ID")));
    }

    public static ConfigurationVersionId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "configuration version ID"));
}
