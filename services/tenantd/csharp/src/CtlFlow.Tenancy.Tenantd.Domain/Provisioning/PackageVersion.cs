using CtlFlow.Tenancy.Tenantd.Domain.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record PackageVersion
{
    private const int MaximumLength = 128;

    private PackageVersion(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<PackageVersion> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new PackageVersion(
            BoundedText.Validate(value, MaximumLength, "Package version")));
    }

    public static PackageVersion FromStorage(string value) =>
        new(BoundedText.ValidateStored(
            value,
            MaximumLength,
            "package version"));
}
