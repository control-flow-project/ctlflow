using static CtlFlow.Edge.Edged.Domain.Identifiers.Identifiers;

namespace CtlFlow.Edge.Edged.Domain.Identifiers;

public sealed class TenantId
{
    private TenantId(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<TenantId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new TenantId(ValidateIdentifier(value, nameof(value))));
    }
}
