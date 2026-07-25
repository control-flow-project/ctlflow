using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record PackageId
{
    private PackageId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<PackageId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new PackageId(
            OpaqueIdentifiers.Validate(value, "Package ID")));
    }

    public static PackageId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(value, "package ID"));
}
