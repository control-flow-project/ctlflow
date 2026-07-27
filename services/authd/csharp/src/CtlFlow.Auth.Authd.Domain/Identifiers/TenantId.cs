using static CtlFlow.Auth.Authd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Auth.Authd.Domain.Identifiers;

public sealed record TenantId
{
    private TenantId(string value) => Value = value;

    public string Value { get; }

    public static TenantId Parse(string value) =>
        new(ValidateIdentifier(value, nameof(value)));
}
