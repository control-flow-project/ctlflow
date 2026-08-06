using System.Text;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public static partial class Packages
{
    public static ValueTask<PackageDraft> CreatePackageDraft(
        PackageId packageId,
        Generation generation,
        SemanticVersion version,
        PackageProvenance provenance,
        IReadOnlyList<PackageComponentSpec> components,
        IReadOnlyList<PackageInterfaceSpec> interfaces,
        IReadOnlyList<PackageDependencySpec> dependencies,
        IReadOnlyList<PackageExposureSpec> exposures,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        EnsureCount(components.Count, 1, 64, "components");
        EnsureCount(interfaces.Count, 0, 256, "interfaces");
        EnsureCount(dependencies.Count, 0, 256, "dependencies");
        EnsureCount(exposures.Count, 0, 256, "exposures");
        EnsureDeclaredOperations(components);

        var componentIds = CreateUniqueSet(
            components.Select(value => value.ComponentId.Value),
            "component ID");
        CreateUniqueSet(
            interfaces.Select(value => value.InterfaceId.Value),
            "interface ID");
        CreateUniqueSet(
            exposures.Select(value => value.ExposureId.Value),
            "exposure ID");
        CreateUniqueSet(
            dependencies
                .Where(value => value.DependencyId is not null)
                .Select(value => value.DependencyId!.Value),
            "dependency ID");
        CreateUniqueSet(
            dependencies.Select(value =>
                $"{value.ComponentId.Value}\0{value.Name.Value}"),
            "dependency name");

        if (interfaces.Any(value =>
                !componentIds.Contains(value.ComponentId.Value))
            || dependencies.Any(value =>
                !componentIds.Contains(value.ComponentId.Value)))
        {
            throw new ArgumentException(
                "A Package component reference does not resolve");
        }

        var interfaceIds = interfaces
            .Select(value => value.InterfaceId.Value)
            .ToHashSet(StringComparer.Ordinal);
        if (exposures.Any(value =>
                !interfaceIds.Contains(value.InterfaceId.Value))
            || exposures
                .Select(value => value.InterfaceId.Value)
                .Distinct(StringComparer.Ordinal)
                .Count() != exposures.Count)
        {
            throw new ArgumentException(
                "A Package exposure reference is invalid");
        }

        return ValueTask.FromResult(new PackageDraft(
            packageId,
            generation,
            version,
            provenance,
            components
                .OrderBy(value => value.ComponentId.Value, StringComparer.Ordinal)
                .ToArray(),
            interfaces
                .OrderBy(value => value.InterfaceId.Value, StringComparer.Ordinal)
                .ToArray(),
            dependencies
                .OrderBy(
                    value => value,
                    PackageDependencySpecComparer.Instance)
                .ToArray(),
            exposures
                .OrderBy(value => value.ExposureId.Value, StringComparer.Ordinal)
                .ToArray()));
    }

    // A component declares at most 64 operations and a generation at most
    // 512, and one component owns a token within the generation. The Package
    // ID supplies the namespace, so a token may repeat in another Package or
    // match a kernel token.
    private const int MaximumOperationsPerComponent = 64;
    private const int MaximumOperationsPerGeneration = 512;

    private static void EnsureDeclaredOperations(
        IReadOnlyList<PackageComponentSpec> components)
    {
        var total = 0;
        foreach (var component in components)
        {
            if (component.DeclaredOperations.Count
                > MaximumOperationsPerComponent)
            {
                throw new PackageLimitExceededException(
                    "A component declares at most 64 operations");
            }

            total += component.DeclaredOperations.Count;
        }

        if (total > MaximumOperationsPerGeneration)
        {
            throw new PackageLimitExceededException(
                "A Package generation declares at most 512 operations");
        }

        CreateUniqueSet(
            components.SelectMany(component =>
                component.DeclaredOperations.Select(
                    operation => operation.Value)),
            "declared operation");
    }

    private static void EnsureCount(
        int count,
        int minimum,
        int maximum,
        string label)
    {
        if (count < minimum)
        {
            throw new ArgumentException(
                $"Package {label} count is below its minimum");
        }

        if (count > maximum)
        {
            throw new PackageLimitExceededException(
                $"Package {label} count exceeds its maximum");
        }
    }

    private static HashSet<string> CreateUniqueSet(
        IEnumerable<string> values,
        string label)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in values)
        {
            if (!result.Add(value))
            {
                throw new ArgumentException(
                    $"Package {label} must be unique");
            }
        }

        return result;
    }

    private sealed class PackageDependencySpecComparer
        : IComparer<PackageDependencySpec>
    {
        internal static readonly PackageDependencySpecComparer Instance = new();

        public int Compare(
            PackageDependencySpec? left,
            PackageDependencySpec? right)
        {
            if (ReferenceEquals(left, right))
            {
                return 0;
            }

            if (left is null)
            {
                return -1;
            }

            if (right is null)
            {
                return 1;
            }

            var component = string.CompareOrdinal(
                left.ComponentId.Value,
                right.ComponentId.Value);
            return component != 0
                ? component
                : CompareUnicodeScalars(left.Name.Value, right.Name.Value);
        }

        private static int CompareUnicodeScalars(string left, string right)
        {
            var leftRunes = left.EnumerateRunes().GetEnumerator();
            var rightRunes = right.EnumerateRunes().GetEnumerator();
            while (true)
            {
                var hasLeft = leftRunes.MoveNext();
                var hasRight = rightRunes.MoveNext();
                if (!hasLeft || !hasRight)
                {
                    return hasLeft == hasRight ? 0 : hasLeft ? 1 : -1;
                }

                var comparison = leftRunes.Current.Value.CompareTo(
                    rightRunes.Current.Value);
                if (comparison != 0)
                {
                    return comparison;
                }
            }
        }
    }
}
