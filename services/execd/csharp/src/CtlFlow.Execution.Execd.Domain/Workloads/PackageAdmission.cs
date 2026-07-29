using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public sealed record PackageAppAdmission(
    PlacementId PlacementId,
    PlacementTarget Scope,
    Revision AppRevision,
    PackageId PackageId,
    Revision PackageGeneration);

public sealed record PackageComponentAdmission(
    ComponentId ComponentId,
    ArtifactRepository ArtifactRepository,
    ManifestDigest ArtifactManifestDigest);

public sealed record PackageDependencyAdmission(
    ComponentId ComponentId,
    DependencyName Name,
    DependencyId? DependencyId,
    DependencyType Type,
    int OptionsLength,
    string OptionsSha256);

public sealed record PackageInterfaceAdmission(
    ComponentId ComponentId,
    InterfaceId InterfaceId,
    InterfaceProtocol Protocol,
    ContractId ContractId,
    int Port);

public sealed record PackageExposureAdmission(
    InterfaceId InterfaceId,
    ExposureId ExposureId);

public sealed record PackageAdmission(
    PackageAppAdmission App,
    IReadOnlyList<PackageComponentAdmission> Components,
    IReadOnlyList<PackageDependencyAdmission> Dependencies,
    IReadOnlyList<PackageInterfaceAdmission> Interfaces,
    IReadOnlyList<PackageExposureAdmission> Exposures);

public sealed record InstalledProvisioner(
    ProvisionerId ProvisionerId,
    ProvisionerSubject Subject);
