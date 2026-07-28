using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using static CtlFlow.Packages.Pkgd.Service.Content.DependencyOptions;
using V1 = CtlFlow.Packages.V1;

namespace CtlFlow.Packages.Pkgd.Service.Grpc.Requests;

internal static partial class PackageRequests
{
    private const int MaximumDeclarationBytes = 1_048_576;

    internal static async ValueTask<ParsedPackageDeclaration>
        CreatePackageDraft(
            V1.DeclarePackageRequest request,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (request.CalculateSize() > MaximumDeclarationBytes)
        {
            throw new PackageLimitExceededException(
                "Package declaration exceeds its byte limit");
        }

        if (request.Provenance is null)
        {
            throw new ArgumentException(
                "Package provenance is required");
        }

        var components = new List<PackageComponentSpec>(
            request.Components.Count);
        foreach (var component in request.Components)
        {
            if (component.Artifact is null)
            {
                throw new ArgumentException(
                    "Every Package component requires an OCI artifact");
            }

            components.Add(new PackageComponentSpec(
                await ComponentId.Parse(
                    component.ComponentId,
                    cancellation),
                new OciArtifact(
                    await OciRepository.Parse(
                        component.Artifact.Repository,
                        cancellation),
                    await Sha256Digest.Parse(
                        component.Artifact.ManifestDigest,
                        cancellation))));
        }

        var interfaces = new List<PackageInterfaceSpec>(
            request.Interfaces.Count);
        foreach (var providedInterface in request.Interfaces)
        {
            interfaces.Add(new PackageInterfaceSpec(
                await InterfaceId.Parse(
                    providedInterface.InterfaceId,
                    cancellation),
                await ComponentId.Parse(
                    providedInterface.ComponentId,
                    cancellation),
                ParseProtocol(providedInterface.Protocol),
                await ContractId.Parse(
                    providedInterface.ContractId,
                    cancellation),
                await InterfacePort.Parse(
                    providedInterface.Port,
                    cancellation)));
        }

        var dependencies = new List<PackageDependencySpec>(
            request.Dependencies.Count);
        var options = new List<DependencyOptionsContent>(
            request.Dependencies.Count);
        foreach (var dependency in request.Dependencies)
        {
            if (dependency.Options is null)
            {
                throw new ArgumentException(
                    "Every Package dependency requires options");
            }

            var componentId = await ComponentId.Parse(
                dependency.ComponentId,
                cancellation);
            var name = await DependencyName.Parse(
                dependency.Name,
                cancellation);
            var content = await ParseContent(
                componentId,
                name,
                dependency.Options.CanonicalJson.Memory,
                cancellation);
            dependencies.Add(new PackageDependencySpec(
                name,
                dependency.HasDependencyId
                    ? await DependencyId.Parse(
                        dependency.DependencyId,
                        cancellation)
                    : null,
                componentId,
                await DependencyType.Parse(
                    dependency.DependencyType,
                    cancellation),
                content.Reference));
            options.Add(content);
        }

        var exposures = new List<PackageExposureSpec>(
            request.Exposures.Count);
        foreach (var exposure in request.Exposures)
        {
            exposures.Add(new PackageExposureSpec(
                await ExposureId.Parse(
                    exposure.ExposureId,
                    cancellation),
                await InterfaceId.Parse(
                    exposure.InterfaceId,
                    cancellation)));
        }

        var draft = await Domain.Packages.Packages.CreatePackageDraft(
            await PackageId.Parse(request.PackageId, cancellation),
            await Generation.Parse(request.Generation, cancellation),
            await SemanticVersion.Parse(request.Version, cancellation),
            new PackageProvenance(
                await SourceUri.Parse(
                    request.Provenance.SourceUri,
                    cancellation),
                await Sha256Digest.Parse(
                    request.Provenance.SourceDigest,
                    cancellation)),
            components,
            interfaces,
            dependencies,
            exposures,
            cancellation);
        return new ParsedPackageDeclaration(draft, options);
    }

    private static Domain.Packages.InterfaceProtocol ParseProtocol(
        V1.InterfaceProtocol value) =>
        value switch
        {
            V1.InterfaceProtocol.Http =>
                Domain.Packages.InterfaceProtocol.Http,
            V1.InterfaceProtocol.Grpc =>
                Domain.Packages.InterfaceProtocol.Grpc,
            _ => throw new ArgumentException(
                "Package interface protocol is invalid")
        };
}

internal sealed record ParsedPackageDeclaration(
    PackageDraft Draft,
    IReadOnlyList<DependencyOptionsContent> Options);
