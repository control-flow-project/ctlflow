using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record PackageId
{
    private PackageId(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<PackageId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new PackageId(
            ValidateDeclarationId(
                value, 128, allowDot: true, "Package ID", stored: false)));
    }

    public static PackageId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 128, allowDot: true, "Package ID", stored: true));

    public override string ToString() => Value;
}
