using System.Security.Cryptography;

namespace CtlFlow.Configuration.Configd.Domain.Content;

public sealed class ConfigurationDigest : IEquatable<ConfigurationDigest>
{
    private readonly byte[] _value;

    private ConfigurationDigest(byte[] value) => _value = value;

    public static ConfigurationDigest FromValidatedContent(
        ReadOnlySpan<byte> content) =>
        new(SHA256.HashData(content));

    public static ConfigurationDigest FromStorage(ReadOnlySpan<byte> value) =>
        value.Length == 32
            ? new ConfigurationDigest(value.ToArray())
            : throw new InvalidOperationException(
                "Stored configuration digest is invalid");

    public void CopyTo(Span<byte> destination)
    {
        if (destination.Length < _value.Length)
        {
            throw new ArgumentException(
                "Digest destination is too small",
                nameof(destination));
        }

        _value.CopyTo(destination);
    }

    public bool Equals(ConfigurationDigest? other) =>
        other is not null
        && CryptographicOperations.FixedTimeEquals(_value, other._value);

    public override bool Equals(object? obj) =>
        obj is ConfigurationDigest other && Equals(other);

    public override int GetHashCode() =>
        BitConverter.ToInt32(_value, 0);

    public override string ToString() => "[configuration-digest]";
}
