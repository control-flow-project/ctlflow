namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageInterfaceSpec(
    InterfaceId InterfaceId,
    ComponentId ComponentId,
    InterfaceProtocol Protocol,
    ContractId ContractId,
    InterfacePort Port);
