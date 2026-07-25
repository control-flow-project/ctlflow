using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditSourceEventId
{
    private AuditSourceEventId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static AuditSourceEventId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(
            value,
            "audit source event ID"));
}
