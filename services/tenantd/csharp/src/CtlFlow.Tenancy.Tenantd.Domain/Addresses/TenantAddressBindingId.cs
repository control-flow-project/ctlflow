using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Addresses;

public sealed record TenantAddressBindingId
{
    private TenantAddressBindingId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static TenantAddressBindingId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(
            value,
            "Tenant address-binding ID"));

    public static TenantAddressBindingId Generate() =>
        new(OpaqueIdentifiers.Generate("tab"));

    public override string ToString() => Value;
}
