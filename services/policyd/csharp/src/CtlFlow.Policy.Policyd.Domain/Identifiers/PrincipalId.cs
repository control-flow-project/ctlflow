using static CtlFlow.Policy.Policyd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Identifiers;

public readonly record struct PrincipalId
{
    private PrincipalId(
        string value,
        PrincipalKind kind)
    {
        Value = value;
        Kind = kind;
    }

    public string Value { get; }

    public PrincipalKind Kind { get; }

    public static PrincipalId Parse(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var separator = value.IndexOf(':');
        if (separator <= 0 || separator == value.Length - 1
            || value.Length > 256)
        {
            throw new ArgumentException(
                "Principal ID is not canonical",
                nameof(value));
        }

        var kind = value[..separator] switch
        {
            "user" => PrincipalKind.Human,
            "service" => PrincipalKind.Service,
            "agent" => PrincipalKind.Virtual,
            _ => throw new ArgumentException(
                "Principal ID is not canonical",
                nameof(value))
        };
        ValidateIdentifier(
            value[(separator + 1)..],
            256 - separator - 1,
            true,
            nameof(value));
        return new PrincipalId(value, kind);
    }

    public static PrincipalId FromStorage(string value) => Parse(value);

    public override string ToString() => Value;
}
