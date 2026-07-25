using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditLeaseId
{
    private AuditLeaseId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static AuditLeaseId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(value, "audit lease ID"));
}
