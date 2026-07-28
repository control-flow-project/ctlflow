using CtlFlow.Packages.Pkgd.Domain.Time;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public class PackageDeclaration
{
    private long _generation;
    private string _packageId = null!;
    private string _sourceDigest = null!;
    private string _sourceUri = null!;
    private string _version = null!;

    private PackageDeclaration()
    {
    }

    internal PackageDeclaration(
        PackageId packageId,
        Generation generation,
        SemanticVersion version,
        PackageProvenance provenance,
        UtcInstant declaredAt)
    {
        _packageId = packageId.Value;
        _generation = generation.Value;
        _version = version.Value;
        _sourceUri = provenance.SourceUri.Value;
        _sourceDigest = provenance.SourceDigest.Value;
        DeclaredAt = declaredAt;
    }

    public PackageId PackageId => PackageId.FromStorage(_packageId);
    public Generation Generation => Generation.FromStorage(_generation);
    public SemanticVersion Version => SemanticVersion.FromStorage(_version);
    public PackageProvenance Provenance => new(
        SourceUri.FromStorage(_sourceUri),
        Sha256Digest.FromStorage(_sourceDigest));
    public UtcInstant DeclaredAt { get; private set; } = null!;
}
