using System.Diagnostics;
using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

[DebuggerDisplay("[REDACTED JWT]")]
internal sealed class SignedJwt(
    string keyId,
    byte[] signingInput,
    byte[] signature,
    JsonDocument claims) : IDisposable
{
    [DebuggerBrowsable(DebuggerBrowsableState.Never)]
    internal string KeyId { get; } = keyId;

    [DebuggerBrowsable(DebuggerBrowsableState.Never)]
    internal byte[] SigningInput { get; } = signingInput;

    [DebuggerBrowsable(DebuggerBrowsableState.Never)]
    internal byte[] Signature { get; } = signature;

    [DebuggerBrowsable(DebuggerBrowsableState.Never)]
    internal JsonElement Claims => claims.RootElement;

    public void Dispose() => claims.Dispose();

    public override string ToString() => "[REDACTED JWT]";
}
