using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record ExposureId
{
    private ExposureId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<ExposureId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new ExposureId(ValidateDeclarationId(
            value, 64, allowDot: false, "exposure ID", stored: false)));
    }

    public static ExposureId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "exposure ID", stored: true));
}
