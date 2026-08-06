using CtlFlow.Packages.Pkgd.Domain.Auditing;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public static partial class Packages
{
    public static ValueTask<PackageMutationResult> DeclarePackage(
        PackageDraft draft,
        PackageDetails? existingByKey,
        Generation? existingVersionGeneration,
        Generation? latestGeneration,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existingByKey is not null)
        {
            return ValueTask.FromResult<PackageMutationResult>(
                PackageDeclarationsEqual(draft, existingByKey)
                    ? new PackageMutationResult.Current(existingByKey)
                    : new PackageMutationResult.AlreadyExists());
        }

        if (existingVersionGeneration is not null)
        {
            return ValueTask.FromResult<PackageMutationResult>(
                new PackageMutationResult.AlreadyExists());
        }

        var expected = latestGeneration is null
            ? Generation.Initial()
            : latestGeneration.Value == long.MaxValue
                ? null
                : latestGeneration.Next();
        if (expected is null || draft.Generation != expected)
        {
            return ValueTask.FromResult<PackageMutationResult>(
                new PackageMutationResult.FailedPrecondition());
        }

        var declaration = new PackageDeclaration(
            draft.PackageId,
            draft.Generation,
            draft.Version,
            draft.Provenance,
            audit.OccurredAt);
        var components = draft.Components
            .Select(value => new PackageComponent(
                draft.PackageId,
                draft.Generation,
                value.ComponentId,
                value.Artifact))
            .ToArray();
        var componentOperations = draft.Components
            .SelectMany(component => component.DeclaredOperations
                .Select(operation => new PackageComponentOperation(
                    draft.PackageId,
                    draft.Generation,
                    component.ComponentId,
                    operation)))
            .ToArray();
        var interfaces = draft.Interfaces
            .Select(value => new PackageInterface(
                draft.PackageId,
                draft.Generation,
                value.InterfaceId,
                value.ComponentId,
                value.Protocol,
                value.ContractId,
                value.Port))
            .ToArray();
        var dependencies = draft.Dependencies
            .Select(value => new PackageDependency(
                draft.PackageId,
                draft.Generation,
                value.ComponentId,
                value.Name,
                value.DependencyId,
                value.DependencyType,
                value.Options))
            .ToArray();
        var exposures = draft.Exposures
            .Select(value => new PackageExposure(
                draft.PackageId,
                draft.Generation,
                value.ExposureId,
                value.InterfaceId))
            .ToArray();
        var details = new PackageDetails(
            draft.PackageId,
            draft.Generation,
            draft.Version,
            draft.Provenance,
            draft.Components,
            draft.Interfaces,
            draft.Dependencies,
            draft.Exposures,
            audit.OccurredAt);
        return ValueTask.FromResult<PackageMutationResult>(
            new PackageMutationResult.Changed(
                new PackageWriteSet(
                    declaration,
                    components,
                    componentOperations,
                    interfaces,
                    dependencies,
                    exposures),
                details,
                CreateAudit(details, audit)));
    }

    private static AuditIntent CreateAudit(
        PackageDetails package,
        AuditContext context) =>
        new AuditIntent.PackageDeclaration(
            AuditEventId.ForPackage(package.PackageId, package.Generation),
            context.Attribution,
            context.Correlation,
            package.DeclaredAt,
            package.PackageId,
            package.Generation);

    private static bool PackageDeclarationsEqual(
        PackageDraft draft,
        PackageDetails existing) =>
        draft.PackageId == existing.PackageId
        && draft.Generation == existing.Generation
        && draft.Version == existing.Version
        && draft.Provenance == existing.Provenance
        && draft.Components.SequenceEqual(existing.Components)
        && draft.Interfaces.SequenceEqual(existing.Interfaces)
        && draft.Dependencies.SequenceEqual(existing.Dependencies)
        && draft.Exposures.SequenceEqual(existing.Exposures);
}
