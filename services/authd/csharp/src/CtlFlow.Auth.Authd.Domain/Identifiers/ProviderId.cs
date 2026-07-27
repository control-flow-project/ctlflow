using static CtlFlow.Auth.Authd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Auth.Authd.Domain.Identifiers;

public sealed record ProviderId
{
    private ProviderId(string value) => Value = value;

    public string Value { get; }

    public static ProviderId Parse(string value) =>
        new(ValidateIdentifier(value, nameof(value)));
}
