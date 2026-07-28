namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record Sha256Digest
{
    private const string Prefix = "sha256:";

    private Sha256Digest(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<Sha256Digest> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static Sha256Digest FromStorage(string value) =>
        Create(value, stored: true);

    public static Sha256Digest FromHash(ReadOnlySpan<byte> hash) =>
        hash.Length == 32
            ? new Sha256Digest(
                Prefix + Convert.ToHexString(hash).ToLowerInvariant())
            : throw new ArgumentException(
                "SHA-256 hash must contain exactly 32 bytes",
                nameof(hash));

    private static Sha256Digest Create(string value, bool stored)
    {
        if (value.Length != Prefix.Length + 64
            || !value.StartsWith(Prefix, StringComparison.Ordinal)
            || value.AsSpan(Prefix.Length).ContainsAnyExcept(
                "0123456789abcdef"))
        {
            throw stored
                ? new InvalidOperationException(
                    "Stored SHA-256 digest is not canonical")
                : new ArgumentException("SHA-256 digest is not canonical");
        }

        return new Sha256Digest(value);
    }
}
