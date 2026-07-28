using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record ComponentId
{
    private ComponentId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<ComponentId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new ComponentId(ValidateDeclarationId(
            value, 64, allowDot: false, "component ID", stored: false)));
    }

    public static ComponentId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "component ID", stored: true));
}
