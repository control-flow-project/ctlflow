using static CtlFlow.Egress.Egressd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Egress.Egressd.Domain.Rules;

public sealed record RuleId : IComparable<RuleId>
{
    private RuleId(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<RuleId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new RuleId(ValidateIdentifier(value, nameof(value))));
    }

    public int CompareTo(RuleId? other) =>
        other is null
            ? 1
            : string.Compare(Value, other.Value, StringComparison.Ordinal);
}
