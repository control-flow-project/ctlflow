namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public class PackageExposure
{
    private string _exposureId = null!;
    private long _generation;
    private string _interfaceId = null!;
    private string _packageId = null!;

    private PackageExposure()
    {
    }

    internal PackageExposure(
        PackageId packageId,
        Generation generation,
        ExposureId exposureId,
        InterfaceId interfaceId)
    {
        _packageId = packageId.Value;
        _generation = generation.Value;
        _exposureId = exposureId.Value;
        _interfaceId = interfaceId.Value;
    }

    public PackageId PackageId => PackageId.FromStorage(_packageId);
    public Generation Generation => Generation.FromStorage(_generation);
    public ExposureId ExposureId => ExposureId.FromStorage(_exposureId);
    public InterfaceId InterfaceId => InterfaceId.FromStorage(_interfaceId);
}
