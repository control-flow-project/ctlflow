using static CtlFlow.Policy.Policyd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Identifiers;

public readonly record struct PackageId
{
    private PackageId(string value) => Value = value;

    public string Value { get; }

    public static PackageId Parse(string value) =>
        new(ValidateIdentifier(value, 128, true, nameof(value)));

    public override string ToString() => Value;
}
