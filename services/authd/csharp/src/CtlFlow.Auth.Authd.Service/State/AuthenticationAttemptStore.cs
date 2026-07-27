using System.Security.Cryptography;
using CtlFlow.Auth.Authd.Domain.State;
using CtlFlow.Auth.Authd.Service.Http;

namespace CtlFlow.Auth.Authd.Service.State;

internal sealed class AuthenticationAttemptStore : IDisposable
{
    private const int MaximumAttempts = 4_096;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, StoredAuthenticationAttempt>
        _attempts = new(StringComparer.Ordinal);
    private bool _disposed;

    internal CreatedAuthenticationAttempt Create(
        AuthenticationAttempt attempt,
        string? replacedBrowserNonce,
        DateTimeOffset currentTime,
        string stateHandle)
    {
        if (!BrowserValues.IsCanonical32ByteValue(stateHandle))
        {
            throw new ArgumentException(
                "State handle is invalid",
                nameof(stateHandle));
        }
        var browserNonce = BrowserValues.Generate();
        var stateDigest = BrowserValues.CreateDigest(stateHandle);
        var nonceDigest = BrowserValues.CreateDigest(browserNonce);
        var stored = new StoredAuthenticationAttempt(
            stateDigest,
            nonceDigest,
            attempt);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            RemoveExpired(currentTime);
            if (replacedBrowserNonce is not null)
            {
                RemoveByNonce(
                    BrowserValues.CreateDigest(replacedBrowserNonce));
            }
            if (_attempts.Count >= MaximumAttempts)
            {
                stored.Dispose();
                throw new HttpContractException(
                    StatusCodes.Status429TooManyRequests,
                    "state_capacity");
            }

            _attempts.Add(Convert.ToHexString(stateDigest), stored);
        }
        return new CreatedAuthenticationAttempt(browserNonce);
    }

    internal AuthenticationAttempt? Consume(
        string stateHandle,
        string browserNonce,
        DateTimeOffset currentTime)
    {
        var stateDigest = BrowserValues.CreateDigest(stateHandle);
        var nonceDigest = BrowserValues.CreateDigest(browserNonce);
        try
        {
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);
                var key = Convert.ToHexString(stateDigest);
                if (!_attempts.TryGetValue(key, out var stored)
                    || stored.Attempt.ExpiresAt <= currentTime
                    || !CryptographicOperations.FixedTimeEquals(
                        stored.StateDigest,
                        stateDigest)
                    || !CryptographicOperations.FixedTimeEquals(
                        stored.NonceDigest,
                        nonceDigest))
                {
                    if (stored is not null
                        && stored.Attempt.ExpiresAt <= currentTime)
                    {
                        _attempts.Remove(key);
                        stored.Dispose();
                    }
                    return null;
                }

                _attempts.Remove(key);
                CryptographicOperations.ZeroMemory(stored.StateDigest);
                CryptographicOperations.ZeroMemory(stored.NonceDigest);
                return stored.Attempt;
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(stateDigest);
            CryptographicOperations.ZeroMemory(nonceDigest);
        }
    }

    internal int Count
    {
        get
        {
            lock (_gate)
            {
                return _attempts.Count;
            }
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            foreach (var attempt in _attempts.Values)
            {
                attempt.Dispose();
            }
            _attempts.Clear();
        }
    }

    private void RemoveExpired(DateTimeOffset currentTime)
    {
        foreach (var item in _attempts
            .Where(item => item.Value.Attempt.ExpiresAt <= currentTime)
            .ToArray())
        {
            _attempts.Remove(item.Key);
            item.Value.Dispose();
        }
    }

    private void RemoveByNonce(byte[] nonceDigest)
    {
        try
        {
            foreach (var item in _attempts)
            {
                if (!CryptographicOperations.FixedTimeEquals(
                        item.Value.NonceDigest,
                        nonceDigest))
                {
                    continue;
                }

                _attempts.Remove(item.Key);
                item.Value.Dispose();
                return;
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(nonceDigest);
        }
    }
}
