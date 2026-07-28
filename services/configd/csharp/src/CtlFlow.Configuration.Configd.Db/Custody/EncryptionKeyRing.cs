namespace CtlFlow.Configuration.Configd.Db.Custody;

public sealed class EncryptionKeyRing : IDisposable
{
    private IReadOnlyDictionary<EncryptionKeyId, EncryptionKey>? _keys;

    internal EncryptionKeyRing(
        EncryptionKeyId activeKeyId,
        IReadOnlyDictionary<EncryptionKeyId, EncryptionKey> keys)
    {
        ActiveKeyId = activeKeyId;
        _keys = keys;
    }

    public EncryptionKeyId ActiveKeyId { get; }

    public bool Contains(EncryptionKeyId keyId) =>
        RequireKeys().ContainsKey(keyId);

    internal EncryptionKey Get(EncryptionKeyId keyId) =>
        RequireKeys().TryGetValue(keyId, out var key)
            ? key
            : throw new InvalidOperationException(
                "The encryption key ring does not contain a required key");

    public void Dispose()
    {
        var keys = Interlocked.Exchange(ref _keys, null);
        if (keys is null)
        {
            return;
        }

        foreach (var key in keys.Values)
        {
            key.Dispose();
        }
    }

    private IReadOnlyDictionary<EncryptionKeyId, EncryptionKey> RequireKeys() =>
        _keys ?? throw new ObjectDisposedException(
            nameof(EncryptionKeyRing));
}
