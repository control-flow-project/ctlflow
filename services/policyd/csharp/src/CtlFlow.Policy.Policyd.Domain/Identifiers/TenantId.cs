using static CtlFlow.Policy.Policyd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Identifiers;

public readonly record struct TenantId
{
    private TenantId(string value) => Value = value;

    public string Value { get; }

    public static TenantId Parse(string value) =>
        new(ValidateIdentifier(value, 64, false, nameof(value)));

    public static TenantId FromStorage(string value) => Parse(value);

    public override string ToString() => Value;
}
