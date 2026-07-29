using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal sealed class SecretValues(
    IReadOnlyDictionary<SecretName, SecretValue> values)
{
    private readonly IReadOnlyDictionary<SecretName, SecretValue> _values =
        values;

    internal bool TryRead(
        SecretName name,
        out SecretValue? value) =>
        _values.TryGetValue(name, out value);
}
