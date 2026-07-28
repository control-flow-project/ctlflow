using static CtlFlow.Policy.Policyd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Identifiers;

public readonly record struct RoleId
{
    private RoleId(string value) => Value = value;

    public string Value { get; }

    public static RoleId Parse(string value) =>
        new(ValidateIdentifier(value, 128, true, nameof(value)));

    public static RoleId FromStorage(string value) => Parse(value);

    public override string ToString() => Value;
}
