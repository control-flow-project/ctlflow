using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record DependencyId
{
    private DependencyId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<DependencyId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new DependencyId(ValidateDeclarationId(
            value, 64, allowDot: false, "dependency ID", stored: false)));
    }

    public static DependencyId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "dependency ID", stored: true));
}
