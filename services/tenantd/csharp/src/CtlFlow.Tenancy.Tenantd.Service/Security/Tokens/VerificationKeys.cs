namespace CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;

using static JsonWebKeys;

internal sealed class VerificationKeys(
    string path,
    TimeSpan cacheLifetime) : IAsyncDisposable
{
    private readonly string _path = path;
    private readonly TimeSpan _cacheLifetime = cacheLifetime;
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
                snapshot = await ReloadVerificationKeys(
                    _path,
                    _cacheLifetime,
                    cancellation);
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
