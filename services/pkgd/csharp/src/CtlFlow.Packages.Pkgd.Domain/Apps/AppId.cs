using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record AppId
{
    private AppId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<AppId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new AppId(ValidateDeclarationId(
            value, 64, allowDot: false, "App ID", stored: false)));
    }

    public static AppId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "App ID", stored: true));
}
