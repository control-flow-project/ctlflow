using CtlFlow.Packages.Pkgd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        PackageDatabase packageDatabase,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = PackageDbTelemetry.StartOperation(
            "verify_schema");
        var ledger = await VerifyMigrationLedger(packageDatabase, cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await using var database = await packageDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await database.PackageGenerations
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_packageId"))
            .ThenBy(value => EF.Property<long>(value, "_generation"))
            .Select(value => new
            {
                PackageId = EF.Property<string>(value, "_packageId"),
                Generation = EF.Property<long>(value, "_generation"),
                Version = EF.Property<string>(value, "_version"),
                SourceUri = EF.Property<string>(value, "_sourceUri"),
                SourceDigest = EF.Property<string>(value, "_sourceDigest"),
                value.DeclaredAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PackageComponents
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_packageId"))
            .ThenBy(value => EF.Property<long>(value, "_generation"))
            .ThenBy(value => EF.Property<string>(value, "_componentId"))
            .Select(value => new
            {
                PackageId = EF.Property<string>(value, "_packageId"),
                Generation = EF.Property<long>(value, "_generation"),
                ComponentId = EF.Property<string>(value, "_componentId"),
                Repository = EF.Property<string>(value, "_repository"),
                Digest = EF.Property<string>(value, "_manifestDigest")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PackageInterfaces.AsNoTracking()
            .Select(value => new
            {
                PackageId = EF.Property<string>(value, "_packageId"),
                Generation = EF.Property<long>(value, "_generation"),
                InterfaceId = EF.Property<string>(value, "_interfaceId"),
                ComponentId = EF.Property<string>(value, "_componentId"),
                Protocol = EF.Property<int>(value, "_protocol"),
                ContractId = EF.Property<string>(value, "_contractId"),
                Port = EF.Property<int>(value, "_port")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PackageDependencies.AsNoTracking()
            .Select(value => new
            {
                PackageId = EF.Property<string>(value, "_packageId"),
                Generation = EF.Property<long>(value, "_generation"),
                ComponentId = EF.Property<string>(value, "_componentId"),
                Name = EF.Property<string>(value, "_dependencyName"),
                Id = EF.Property<string?>(value, "_dependencyId"),
                Type = EF.Property<string>(value, "_dependencyType")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PackageDependencyOptions.AsNoTracking()
            .Select(value => new
            {
                value.PackageId,
                value.Generation,
                value.ComponentId,
                value.DependencyName,
                value.Format,
                value.ByteLength,
                value.Digest,
                value.CanonicalJson
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.PackageExposures.AsNoTracking()
            .Select(value => new
            {
                PackageId = EF.Property<string>(value, "_packageId"),
                Generation = EF.Property<long>(value, "_generation"),
                ExposureId = EF.Property<string>(value, "_exposureId"),
                InterfaceId = EF.Property<string>(value, "_interfaceId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Apps.AsNoTracking()
            .Select(value => new
            {
                AppId = EF.Property<string>(value, "_appId"),
                ScopeKind = EF.Property<int>(value, "_scopeKind"),
                TenantId = EF.Property<string?>(value, "_tenantId"),
                WorkspaceId = EF.Property<string?>(value, "_workspaceId"),
                AccountId =
                    EF.Property<string?>(value, "_accountPrincipalId"),
                PlacementId = EF.Property<string>(value, "_placementId"),
                PackageId = EF.Property<string>(value, "_packageId"),
                InitialGeneration =
                    EF.Property<long>(
                        value,
                        "_initialPackageGeneration"),
                DesiredGeneration =
                    EF.Property<long>(
                        value,
                        "_desiredPackageGeneration"),
                Revision = EF.Property<long>(value, "_revision"),
                value.CreatedAt,
                value.UpdatedAt
            })
            .Take(1)
            .ToListAsync(queryCancellation);

        return SchemaCompatibility.Compatible;
    }
}
