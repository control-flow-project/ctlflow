using static CtlFlow.Egress.Egressd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Egress.Egressd.Domain.Bindings;

public sealed record BindingId
{
    private BindingId(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<BindingId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new BindingId(ValidateIdentifier(value, nameof(value))));
    }
}
