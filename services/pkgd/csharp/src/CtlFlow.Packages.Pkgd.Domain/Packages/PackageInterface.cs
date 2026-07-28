namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public class PackageInterface
{
    private string _componentId = null!;
    private string _contractId = null!;
    private long _generation;
    private string _interfaceId = null!;
    private string _packageId = null!;
    private int _port;
    private int _protocol;

    private PackageInterface()
    {
    }

    internal PackageInterface(
        PackageId packageId,
        Generation generation,
        InterfaceId interfaceId,
        ComponentId componentId,
        InterfaceProtocol protocol,
        ContractId contractId,
        InterfacePort port)
    {
        _packageId = packageId.Value;
        _generation = generation.Value;
        _interfaceId = interfaceId.Value;
        _componentId = componentId.Value;
        _protocol = (int)protocol;
        _contractId = contractId.Value;
        _port = port.Value;
    }

    public PackageId PackageId => PackageId.FromStorage(_packageId);
    public Generation Generation => Generation.FromStorage(_generation);
    public InterfaceId InterfaceId => InterfaceId.FromStorage(_interfaceId);
    public ComponentId ComponentId => ComponentId.FromStorage(_componentId);
    public InterfaceProtocol Protocol => _protocol switch
    {
        (int)InterfaceProtocol.Http => InterfaceProtocol.Http,
        (int)InterfaceProtocol.Grpc => InterfaceProtocol.Grpc,
        _ => throw new InvalidOperationException(
            "Stored interface protocol is invalid")
    };
    public ContractId ContractId => ContractId.FromStorage(_contractId);
    public InterfacePort Port => InterfacePort.FromStorage(_port);
}
