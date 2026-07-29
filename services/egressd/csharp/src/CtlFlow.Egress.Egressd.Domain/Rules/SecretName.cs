using static CtlFlow.Egress.Egressd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Egress.Egressd.Domain.Rules;

public sealed record SecretName
{
    private SecretName(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<SecretName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            new SecretName(ValidateIdentifier(value, nameof(value))));
    }
}
