using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public sealed record ProviderId
{
    private ProviderId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<ProviderId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new ProviderId(ValidateIdentifier(value, "Provider ID")));
    }

    public static ProviderId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "provider ID"));
}
