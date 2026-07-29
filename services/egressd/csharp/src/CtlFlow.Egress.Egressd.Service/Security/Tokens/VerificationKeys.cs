namespace CtlFlow.Egress.Egressd.Service.Security.Tokens;

internal sealed class VerificationKeys(
    IReadOnlyDictionary<string, RsaVerificationKey> keys)
    : IAsyncDisposable
{
    private readonly IReadOnlyDictionary<string, RsaVerificationKey> _keys =
        keys;

    internal ValueTask<RsaVerificationKey> ResolveKey(
        string keyId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            _keys.TryGetValue(keyId, out var key)
                ? key
                : throw new TokenValidationException());
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
