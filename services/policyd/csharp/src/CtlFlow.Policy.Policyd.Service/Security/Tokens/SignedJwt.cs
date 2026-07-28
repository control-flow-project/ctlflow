using System.Text.Json;

namespace CtlFlow.Policy.Policyd.Service.Security.Tokens;

internal sealed class SignedJwt(
    string algorithm,
    string keyId,
    byte[] signingInput,
    byte[] signature,
    JsonDocument claims) : IDisposable
{
    internal string Algorithm { get; } = algorithm;

    internal string KeyId { get; } = keyId;

    internal byte[] SigningInput { get; } = signingInput;

    internal byte[] Signature { get; } = signature;

    internal JsonElement Claims => claims.RootElement;

    public void Dispose() => claims.Dispose();

    public override string ToString() => "[REDACTED JWT]";
}
