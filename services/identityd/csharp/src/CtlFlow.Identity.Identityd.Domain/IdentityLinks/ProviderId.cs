using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public sealed record ProviderId
{
    private ProviderId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ProviderId Parse(string value) =>
        new(ValidateIdentifier(value, "Provider ID"));

    public static ProviderId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "provider ID"));
}
