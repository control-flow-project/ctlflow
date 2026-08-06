using System.Security.Cryptography;
using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

public static partial class Packages
{
    public static async Task<PackageContentLookupResult> GetPackage(
        PackageDatabase packageDatabase,
        PackageId packageId,
        Generation generation,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = PackageDbTelemetry.StartOperation("get_package");
        return await QueryPackage(
            packageDatabase,
            packageId,
            generation,
            cancellation);
    }

    private static async Task<PackageContentLookupResult> QueryPackage(
        PackageDatabase packageDatabase,
        PackageId packageId,
        Generation generation,
        CancellationToken cancellation)
    {
        await using var database =
            await packageDatabase.Contexts.CreateDbContextAsync(cancellation);
        var packageIdValue = packageId.Value;
        var generationValue = generation.Value;
        var queryCancellation = cancellation;
        var declaration = await database.PackageGenerations
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageIdValue
                && EF.Property<long>(value, "_generation") == generationValue)
            .Select(value => new
            {
                PackageId = EF.Property<string>(value, "_packageId"),
                Generation = EF.Property<long>(value, "_generation"),
                Version = EF.Property<string>(value, "_version"),
                SourceUri = EF.Property<string>(value, "_sourceUri"),
                SourceDigest = EF.Property<string>(value, "_sourceDigest"),
                value.DeclaredAt
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (declaration is null)
        {
            return new PackageContentLookupResult.NotFound();
        }

        var componentRows = await database.PackageComponents
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageIdValue
                && EF.Property<long>(value, "_generation") == generationValue)
            .OrderBy(value => EF.Property<string>(value, "_componentId"))
            .Select(value => new
            {
                ComponentId = EF.Property<string>(value, "_componentId"),
                Repository = EF.Property<string>(value, "_repository"),
                ManifestDigest =
                    EF.Property<string>(value, "_manifestDigest")
            })
            .ToListAsync(queryCancellation);
        var operationRows = await database.PackageComponentOperations
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageIdValue
                && EF.Property<long>(value, "_generation") == generationValue)
            .OrderBy(value => EF.Property<string>(value, "_operation"))
            .Select(value => new
            {
                ComponentId = EF.Property<string>(value, "_componentId"),
                Operation = EF.Property<string>(value, "_operation")
            })
            .ToListAsync(queryCancellation);
        var interfaceRows = await database.PackageInterfaces
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageIdValue
                && EF.Property<long>(value, "_generation") == generationValue)
            .OrderBy(value => EF.Property<string>(value, "_interfaceId"))
            .Select(value => new
            {
                InterfaceId = EF.Property<string>(value, "_interfaceId"),
                ComponentId = EF.Property<string>(value, "_componentId"),
                Protocol = EF.Property<int>(value, "_protocol"),
                ContractId = EF.Property<string>(value, "_contractId"),
                Port = EF.Property<int>(value, "_port")
            })
            .ToListAsync(queryCancellation);
        var dependencyRows = await database.PackageDependencies
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageIdValue
                && EF.Property<long>(value, "_generation") == generationValue)
            .OrderBy(value => EF.Property<string>(value, "_componentId"))
            .ThenBy(value => EF.Property<string>(value, "_dependencyName"))
            .Select(value => new
            {
                ComponentId = EF.Property<string>(value, "_componentId"),
                Name = EF.Property<string>(value, "_dependencyName"),
                DependencyId =
                    EF.Property<string?>(value, "_dependencyId"),
                DependencyType =
                    EF.Property<string>(value, "_dependencyType")
            })
            .ToListAsync(queryCancellation);
        var optionRows = await database.PackageDependencyOptions
            .AsNoTracking()
            .Where(value =>
                value.PackageId == packageIdValue
                && value.Generation == generationValue)
            .OrderBy(value => value.ComponentId)
            .ThenBy(value => value.DependencyName)
            .Select(value => new
            {
                value.ComponentId,
                value.DependencyName,
                value.Format,
                value.ByteLength,
                value.Digest,
                value.CanonicalJson
            })
            .ToListAsync(queryCancellation);
        var exposureRows = await database.PackageExposures
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageIdValue
                && EF.Property<long>(value, "_generation") == generationValue)
            .OrderBy(value => EF.Property<string>(value, "_exposureId"))
            .Select(value => new
            {
                ExposureId = EF.Property<string>(value, "_exposureId"),
                InterfaceId = EF.Property<string>(value, "_interfaceId")
            })
            .ToListAsync(queryCancellation);

        var options = optionRows.Select(value =>
        {
            var reference = DependencyOptionsReference.FromStorage(
                value.Format,
                value.ByteLength,
                value.Digest);
            if (value.CanonicalJson.Length != reference.ByteLength
                || Sha256Digest.FromHash(
                    SHA256.HashData(value.CanonicalJson)) != reference.Digest)
            {
                throw new InvalidOperationException(
                    "Stored dependency options content is inconsistent");
            }

            return new DependencyOptionsContent(
                ComponentId.FromStorage(value.ComponentId),
                DependencyName.FromStorage(value.DependencyName),
                reference,
                value.CanonicalJson);
        }).ToArray();
        if (options.Length != dependencyRows.Count)
        {
            throw new InvalidOperationException(
                "Stored Package dependency options are incomplete");
        }

        var optionMap = options.ToDictionary(
            value => CreateDependencyKey(
                value.ComponentId.Value,
                value.DependencyName.Value),
            StringComparer.Ordinal);
        var dependencies = dependencyRows.Select(value =>
        {
            if (!optionMap.TryGetValue(
                    CreateDependencyKey(value.ComponentId, value.Name),
                    out var content))
            {
                throw new InvalidOperationException(
                    "Stored Package dependency options do not resolve");
            }

            return new PackageDependencySpec(
                DependencyName.FromStorage(value.Name),
                value.DependencyId is null
                    ? null
                    : Domain.Packages.DependencyId.FromStorage(
                        value.DependencyId),
                ComponentId.FromStorage(value.ComponentId),
                DependencyType.FromStorage(value.DependencyType),
                content.Reference);
        }).ToArray();
        var details = new PackageDetails(
            PackageId.FromStorage(declaration.PackageId),
            Generation.FromStorage(declaration.Generation),
            SemanticVersion.FromStorage(declaration.Version),
            new PackageProvenance(
                SourceUri.FromStorage(declaration.SourceUri),
                Sha256Digest.FromStorage(declaration.SourceDigest)),
            componentRows.Select(value => new PackageComponentSpec(
                ComponentId.FromStorage(value.ComponentId),
                new OciArtifact(
                    OciRepository.FromStorage(value.Repository),
                    Sha256Digest.FromStorage(value.ManifestDigest)),
                operationRows
                    .Where(row => row.ComponentId == value.ComponentId)
                    .Select(row => DeclaredOperation.FromStorage(row.Operation))
                    .ToArray()))
                .ToArray(),
            interfaceRows.Select(value => new PackageInterfaceSpec(
                InterfaceId.FromStorage(value.InterfaceId),
                ComponentId.FromStorage(value.ComponentId),
                ParseInterfaceProtocol(value.Protocol),
                ContractId.FromStorage(value.ContractId),
                InterfacePort.FromStorage(value.Port)))
                .ToArray(),
            dependencies,
            exposureRows.Select(value => new PackageExposureSpec(
                ExposureId.FromStorage(value.ExposureId),
                InterfaceId.FromStorage(value.InterfaceId)))
                .ToArray(),
            declaration.DeclaredAt);
        return new PackageContentLookupResult.Found(details, options);
    }

    private static string CreateDependencyKey(
        string componentId,
        string dependencyName) =>
        componentId + "\0" + dependencyName;

    private static InterfaceProtocol ParseInterfaceProtocol(int value) =>
        value switch
        {
            (int)InterfaceProtocol.Http => InterfaceProtocol.Http,
            (int)InterfaceProtocol.Grpc => InterfaceProtocol.Grpc,
            _ => throw new InvalidOperationException(
                "Stored interface protocol is invalid")
        };
}
