using static CtlFlow.Policy.Policyd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Identifiers;

public readonly record struct AppId
{
    private AppId(string value) => Value = value;

    public string Value { get; }

    public static AppId Parse(string value) =>
        new(ValidateIdentifier(value, 64, false, nameof(value)));

    public override string ToString() => Value;
}
