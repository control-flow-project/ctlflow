namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public class PackageComponent
{
    private string _componentId = null!;
    private long _generation;
    private string _manifestDigest = null!;
    private string _packageId = null!;
    private string _repository = null!;

    private PackageComponent()
    {
    }

    internal PackageComponent(
        PackageId packageId,
        Generation generation,
        ComponentId componentId,
        OciArtifact artifact)
    {
        _packageId = packageId.Value;
        _generation = generation.Value;
        _componentId = componentId.Value;
        _repository = artifact.Repository.Value;
        _manifestDigest = artifact.ManifestDigest.Value;
    }

    public PackageId PackageId => PackageId.FromStorage(_packageId);
    public Generation Generation => Generation.FromStorage(_generation);
    public ComponentId ComponentId => ComponentId.FromStorage(_componentId);
    public OciArtifact Artifact => new(
        OciRepository.FromStorage(_repository),
        Sha256Digest.FromStorage(_manifestDigest));
}
