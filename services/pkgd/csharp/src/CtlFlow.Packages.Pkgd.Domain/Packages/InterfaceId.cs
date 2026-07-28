using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record InterfaceId
{
    private InterfaceId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<InterfaceId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new InterfaceId(ValidateDeclarationId(
            value, 64, allowDot: false, "interface ID", stored: false)));
    }

    public static InterfaceId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "interface ID", stored: true));
}
