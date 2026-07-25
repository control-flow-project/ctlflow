using CtlFlow.Tenancy.Tenantd.Domain.Text;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditOperationName
{
    private const int MaximumLength = 64;

    private AuditOperationName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static AuditOperationName FromStorage(string value) =>
        new(BoundedText.ValidateStored(
            value,
            MaximumLength,
            "audit operation name"));
}
