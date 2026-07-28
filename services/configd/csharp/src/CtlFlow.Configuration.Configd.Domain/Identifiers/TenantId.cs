using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record TenantId
{
    private TenantId(string value) => Value = value;

    public string Value { get; }

    public static TenantId Parse(string value) =>
        new(ValidateIdentifier(value, "Tenant ID"));

    public static TenantId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "tenant ID"));
}
