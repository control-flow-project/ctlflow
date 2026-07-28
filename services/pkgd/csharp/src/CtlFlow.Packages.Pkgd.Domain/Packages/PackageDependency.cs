namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public class PackageDependency
{
    private string _componentId = null!;
    private string? _dependencyId;
    private string _dependencyName = null!;
    private string _dependencyType = null!;
    private long _generation;
    private string _optionsDigest = null!;
    private int _optionsFormat;
    private int _optionsLength;
    private string _packageId = null!;

    private PackageDependency()
    {
    }

    internal PackageDependency(
        PackageId packageId,
        Generation generation,
        ComponentId componentId,
        DependencyName name,
        DependencyId? dependencyId,
        DependencyType dependencyType,
        DependencyOptionsReference options)
    {
        _packageId = packageId.Value;
        _generation = generation.Value;
        _componentId = componentId.Value;
        _dependencyName = name.Value;
        _dependencyId = dependencyId?.Value;
        _dependencyType = dependencyType.Value;
        _optionsFormat = (int)options.Format;
        _optionsLength = options.ByteLength;
        _optionsDigest = options.Digest.Value;
    }

    public PackageId PackageId => PackageId.FromStorage(_packageId);
    public Generation Generation => Generation.FromStorage(_generation);
    public ComponentId ComponentId => ComponentId.FromStorage(_componentId);
    public DependencyName Name => DependencyName.FromStorage(_dependencyName);
    public DependencyId? DependencyId => _dependencyId is null
        ? null
        : DependencyId.FromStorage(_dependencyId);
    public DependencyType DependencyType =>
        DependencyType.FromStorage(_dependencyType);
    public DependencyOptionsReference Options =>
        DependencyOptionsReference.FromStorage(
            _optionsFormat,
            _optionsLength,
            _optionsDigest);
}
