namespace CtlFlow.Packages.Pkgd.Db.Content;

public class DependencyOptionsContentRow
{
    private DependencyOptionsContentRow()
    {
    }

    internal DependencyOptionsContentRow(
        string packageId,
        long generation,
        string componentId,
        string dependencyName,
        int format,
        int byteLength,
        string digest,
        byte[] canonicalJson)
    {
        PackageId = packageId;
        Generation = generation;
        ComponentId = componentId;
        DependencyName = dependencyName;
        Format = format;
        ByteLength = byteLength;
        Digest = digest;
        CanonicalJson = canonicalJson;
    }

    public string PackageId { get; private set; } = null!;

    public long Generation { get; private set; }

    public string ComponentId { get; private set; } = null!;

    public string DependencyName { get; private set; } = null!;

    public int Format { get; private set; }

    public int ByteLength { get; private set; }

    public string Digest { get; private set; } = null!;

    public byte[] CanonicalJson { get; private set; } = null!;
}
