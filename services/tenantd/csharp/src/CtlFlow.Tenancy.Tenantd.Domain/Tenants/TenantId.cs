using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Tenants;

public sealed record TenantId
{
    private TenantId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<TenantId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        return ValueTask.FromResult(new TenantId(
            OpaqueIdentifiers.Validate(value, "Tenant ID")));
    }

    public static TenantId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(value, "Tenant ID"));

    public static TenantId Generate() =>
        new(OpaqueIdentifiers.Generate("tnt"));

    public override string ToString() => Value;
}
