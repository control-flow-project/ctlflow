namespace CtlFlow.Packages.Pkgd.Service.Security.Tokens;

internal sealed class VerificationKeys(
    VerificationKeyLoader load) : IAsyncDisposable
{
    private readonly VerificationKeyLoader _load = load;
    private readonly SemaphoreSlim _reloadLock = new(1, 1);
    private VerificationKeySnapshot? _snapshot;

    internal async ValueTask<RsaVerificationKey> ResolveKey(
        string keyId,
        CancellationToken cancellation)
    {
        var snapshot = _snapshot;
        if (snapshot is not null
            && snapshot.ExpiresAt > DateTimeOffset.UtcNow
            && snapshot.Keys.TryGetValue(keyId, out var cached))
        {
            return cached;
        }

        await _reloadLock.WaitAsync(cancellation);
        try
        {
            snapshot = _snapshot;
            if (snapshot is null
                || snapshot.ExpiresAt <= DateTimeOffset.UtcNow
                || !snapshot.Keys.ContainsKey(keyId))
            {
                snapshot = await _load(cancellation);
                _snapshot = snapshot;
            }

            return snapshot.Keys.TryGetValue(keyId, out var key)
                ? key
                : throw new TokenValidationException();
        }
        finally
        {
            _reloadLock.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        _reloadLock.Dispose();
        return ValueTask.CompletedTask;
    }
}
