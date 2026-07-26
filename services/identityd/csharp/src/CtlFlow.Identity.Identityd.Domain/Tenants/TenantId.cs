using static CtlFlow.Identity.Identityd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Identity.Identityd.Domain.Tenants;

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
        return ValueTask.FromResult(
            new TenantId(ValidateIdentifier(value, "Tenant ID")));
    }

    public static TenantId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "Tenant ID"));

    public override string ToString() => Value;
}
