namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record DependencyOptionsReference(
    DependencyOptionsFormat Format,
    int ByteLength,
    Sha256Digest Digest)
{
    public static DependencyOptionsReference Create(
        int byteLength,
        Sha256Digest digest)
    {
        if (byteLength is < 2 or > 65_536)
        {
            throw new ArgumentException(
                "Dependency options length is outside its bound",
                nameof(byteLength));
        }

        return new DependencyOptionsReference(
            DependencyOptionsFormat.CanonicalJson,
            byteLength,
            digest);
    }

    public static DependencyOptionsReference FromStorage(
        int format,
        int byteLength,
        string digest) =>
        format == (int)DependencyOptionsFormat.CanonicalJson
            ? Create(byteLength, Sha256Digest.FromStorage(digest))
            : throw new InvalidOperationException(
                "Stored dependency options format is invalid");
}
