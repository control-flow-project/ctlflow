using System.Security.Cryptography;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Packages.V1;
using DomainInterfaceProtocol =
    CtlFlow.Execution.Execd.Domain.Resources.InterfaceProtocol;
using DomainPackageAdmission =
    CtlFlow.Execution.Execd.Domain.Workloads.PackageAdmission;
using PackageInterfaceProtocol =
    CtlFlow.Packages.V1.InterfaceProtocol;
using DbDependencyOptionsContent =
    CtlFlow.Execution.Execd.Db.Workloads.DependencyOptionsContent;

namespace CtlFlow.Execution.Execd.Service.Packages;

internal static partial class PackageAdmission
{
    internal static MappedPackageAdmission MapPackage(
        PackageAppAdmission app,
        Package package)
    {
        try
        {
            var options = new List<DbDependencyOptionsContent>(
                package.Dependencies.Count);
            var dependencies = package.Dependencies.Select(item =>
            {
                var componentId = ComponentId.Parse(item.ComponentId);
                var name = DependencyName.Parse(item.Name);
                var content = item.Options?.CanonicalJson.Memory
                    ?? throw InvalidPackage();
                options.Add(new DbDependencyOptionsContent(
                    componentId,
                    name,
                    content));
                return new PackageDependencyAdmission(
                    componentId,
                    name,
                    item.HasDependencyId
                        ? DependencyId.Parse(item.DependencyId)
                        : null,
                    DependencyType.Parse(item.DependencyType),
                    content.Length,
                    Convert.ToHexString(
                        SHA256.HashData(content.Span))
                        .ToLowerInvariant());
            }).ToArray();
            return new MappedPackageAdmission(
                new DomainPackageAdmission(
                    app,
                    package.Components.Select(item =>
                    {
                        var artifact = item.Artifact
                            ?? throw InvalidPackage();
                        return new PackageComponentAdmission(
                            ComponentId.Parse(item.ComponentId),
                            ArtifactRepository.Parse(
                                artifact.Repository),
                            ManifestDigest.Parse(
                                artifact.ManifestDigest));
                    }).ToArray(),
                    dependencies,
                    package.Interfaces.Select(item =>
                        new PackageInterfaceAdmission(
                            ComponentId.Parse(item.ComponentId),
                            InterfaceId.Parse(item.InterfaceId),
                            item.Protocol switch
                            {
                                PackageInterfaceProtocol.Http =>
                                    DomainInterfaceProtocol.Http,
                                PackageInterfaceProtocol.Grpc =>
                                    DomainInterfaceProtocol.Grpc,
                                _ => throw InvalidPackage()
                            },
                            ContractId.Parse(item.ContractId),
                            checked((int)item.Port))).ToArray(),
                    package.Exposures.Select(item =>
                        new PackageExposureAdmission(
                            InterfaceId.Parse(item.InterfaceId),
                            ExposureId.Parse(
                                item.ExposureId))).ToArray()),
                options);
        }
        catch (Exception exception) when (
            exception is ArgumentException
                or InvalidOperationException
                or OverflowException)
        {
            throw InvalidPackage();
        }
    }

    private static ExecutionException InvalidPackage() =>
        new(
            ExecutionError.Unavailable,
            "Pkgd returned an invalid Package");
}
