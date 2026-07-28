using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record PlacementId
{
    private PlacementId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<PlacementId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new PlacementId(ValidateDeclarationId(
            value, 64, allowDot: false, "Placement ID", stored: false)));
    }

    public static PlacementId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "Placement ID", stored: true));
}
