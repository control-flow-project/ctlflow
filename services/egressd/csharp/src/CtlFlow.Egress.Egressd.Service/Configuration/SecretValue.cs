using System.Diagnostics;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

[DebuggerDisplay("[REDACTED]")]
internal sealed class SecretValue
{
    [DebuggerBrowsable(DebuggerBrowsableState.Never)]
    private readonly string _material;

    internal SecretValue(string material) => _material = material;

    internal string ReadForHeader() => _material;

    public override string ToString() => "[REDACTED]";
}
