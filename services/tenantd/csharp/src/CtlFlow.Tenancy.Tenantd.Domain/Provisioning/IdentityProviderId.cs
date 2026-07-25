using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record IdentityProviderId
{
    private IdentityProviderId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<IdentityProviderId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new IdentityProviderId(
            OpaqueIdentifiers.Validate(value, "Identity provider ID")));
    }

    public static IdentityProviderId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(
            value,
            "identity provider ID"));
}
