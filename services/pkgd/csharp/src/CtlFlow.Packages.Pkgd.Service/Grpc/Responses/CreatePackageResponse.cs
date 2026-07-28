using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using Google.Protobuf;
using Google.Protobuf.WellKnownTypes;
using DomainProtocol =
    CtlFlow.Packages.Pkgd.Domain.Packages.InterfaceProtocol;
using V1 = CtlFlow.Packages.V1;

namespace CtlFlow.Packages.Pkgd.Service.Grpc.Responses;

internal static partial class PackageResponses
{
    internal static ValueTask<V1.Package> CreatePackageResponse(
        PackageDetails package,
        IReadOnlyList<DependencyOptionsContent> options,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var optionMap = options.ToDictionary(
            value => CreateDependencyKey(
                value.ComponentId.Value,
                value.DependencyName.Value),
            StringComparer.Ordinal);
        var response = new V1.Package
        {
            PackageId = package.PackageId.Value,
            Generation = checked((ulong)package.Generation.Value),
            Version = package.Version.Value,
            Provenance = new V1.PackageProvenance
            {
                SourceUri = package.Provenance.SourceUri.Value,
                SourceDigest = package.Provenance.SourceDigest.Value
            },
            DeclaredAt = Timestamp.FromDateTimeOffset(
                package.DeclaredAt.Value)
        };
        response.Components.Add(package.Components.Select(value =>
            new V1.PackageComponent
            {
                ComponentId = value.ComponentId.Value,
                Artifact = new V1.OciArtifact
                {
                    Repository = value.Artifact.Repository.Value,
                    ManifestDigest = value.Artifact.ManifestDigest.Value
                }
            }));
        response.Interfaces.Add(package.Interfaces.Select(value =>
            new V1.PackageInterface
            {
                InterfaceId = value.InterfaceId.Value,
                ComponentId = value.ComponentId.Value,
                Protocol = MapProtocol(value.Protocol),
                ContractId = value.ContractId.Value,
                Port = checked((uint)value.Port.Value)
            }));
        foreach (var dependency in package.Dependencies)
        {
            if (!optionMap.TryGetValue(
                    CreateDependencyKey(
                        dependency.ComponentId.Value,
                        dependency.Name.Value),
                    out var content)
                || content.Reference != dependency.Options)
            {
                throw new InvalidOperationException(
                    "Package dependency content is inconsistent");
            }

            var item = new V1.PackageDependency
            {
                Name = dependency.Name.Value,
                ComponentId = dependency.ComponentId.Value,
                DependencyType = dependency.DependencyType.Value,
                Options = new V1.DependencyOptionsContent
                {
                    CanonicalJson = ByteString.CopyFrom(
                        content.CanonicalJson)
                }
            };
            if (dependency.DependencyId is not null)
            {
                item.DependencyId = dependency.DependencyId.Value;
            }

            response.Dependencies.Add(item);
        }

        response.Exposures.Add(package.Exposures.Select(value =>
            new V1.PackageExposure
            {
                ExposureId = value.ExposureId.Value,
                InterfaceId = value.InterfaceId.Value
            }));
        return ValueTask.FromResult(response);
    }

    private static V1.InterfaceProtocol MapProtocol(
        DomainProtocol value) =>
        value switch
        {
            DomainProtocol.Http =>
                V1.InterfaceProtocol.Http,
            DomainProtocol.Grpc =>
                V1.InterfaceProtocol.Grpc,
            _ => throw new InvalidOperationException(
                "Package interface protocol is invalid")
        };

    private static string CreateDependencyKey(
        string componentId,
        string dependencyName) =>
        componentId + "\0" + dependencyName;
}
