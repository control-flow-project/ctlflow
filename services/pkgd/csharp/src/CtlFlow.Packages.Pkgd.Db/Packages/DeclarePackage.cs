using CtlFlow.Packages.Pkgd.Db.Content;
using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Domain.Auditing;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

public static partial class Packages
{
    public static async Task<PackageDeclarationResult> DeclarePackage(
        PackageDatabase packageDatabase,
        PackageDraft draft,
        IReadOnlyList<DependencyOptionsContent> options,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = PackageDbTelemetry.StartOperation(
            "declare_package");
        ValidateOptions(draft, options);
        await using var mutation =
            await packageDatabase.AcquireMutation(cancellation);

        var existingLookup = await QueryPackage(
            packageDatabase,
            draft.PackageId,
            draft.Generation,
            cancellation);
        var existing = existingLookup is PackageContentLookupResult.Found found
            ? found.Package
            : null;
        var packageId = draft.PackageId.Value;
        var version = draft.Version.Value;
        var queryCancellation = cancellation;
        await using var database =
            await packageDatabase.Contexts.CreateDbContextAsync(cancellation);
        var existingVersionValue = await database.PackageGenerations
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageId
                && EF.Property<string>(value, "_version") == version)
            .Select(value => (long?)EF.Property<long>(value, "_generation"))
            .SingleOrDefaultAsync(queryCancellation);
        var latestGenerationValue = await database.PackageGenerations
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_packageId") == packageId)
            .Select(value => (long?)EF.Property<long>(value, "_generation"))
            .MaxAsync(queryCancellation);

        var decision = await Domain.Packages.Packages.DeclarePackage(
            draft,
            existing,
            existingVersionValue is null
                ? null
                : Generation.FromStorage(existingVersionValue.Value),
            latestGenerationValue is null
                ? null
                : Generation.FromStorage(latestGenerationValue.Value),
            audit,
            cancellation);
        if (decision is not PackageMutationResult.Changed changed)
        {
            return new PackageDeclarationResult(
                decision,
                existingLookup is PackageContentLookupResult.Found existingFound
                    ? existingFound.Options
                    : Array.Empty<DependencyOptionsContent>());
        }

        database.PackageGenerations.Add(changed.Package.Declaration);
        database.PackageComponents.AddRange(changed.Package.Components);
        database.PackageComponentOperations.AddRange(
            changed.Package.ComponentOperations);
        database.PackageInterfaces.AddRange(changed.Package.Interfaces);
        database.PackageDependencies.AddRange(changed.Package.Dependencies);
        database.PackageDependencyOptions.AddRange(options.Select(value =>
            new DependencyOptionsContentRow(
                draft.PackageId.Value,
                draft.Generation.Value,
                value.ComponentId.Value,
                value.DependencyName.Value,
                (int)value.Reference.Format,
                value.Reference.ByteLength,
                value.Reference.Digest.Value,
                value.CanonicalJson)));
        database.PackageExposures.AddRange(changed.Package.Exposures);
        await database.SaveChangesAsync(queryCancellation);
        return new PackageDeclarationResult(decision, options);
    }

    private static void ValidateOptions(
        PackageDraft draft,
        IReadOnlyList<DependencyOptionsContent> options)
    {
        if (draft.Dependencies.Count != options.Count)
        {
            throw new ArgumentException(
                "Dependency options must match every Package dependency");
        }

        var expected = draft.Dependencies.ToDictionary(
            value => CreateDependencyKey(
                value.ComponentId.Value,
                value.Name.Value),
            StringComparer.Ordinal);
        foreach (var content in options)
        {
            var key = CreateDependencyKey(
                content.ComponentId.Value,
                content.DependencyName.Value);
            if (!expected.Remove(key, out var dependency)
                || dependency.Options != content.Reference
                || content.CanonicalJson.Length
                    != content.Reference.ByteLength)
            {
                throw new ArgumentException(
                    "Dependency options do not match the Package declaration");
            }
        }

        if (expected.Count != 0)
        {
            throw new ArgumentException(
                "Dependency options are incomplete");
        }
    }
}
