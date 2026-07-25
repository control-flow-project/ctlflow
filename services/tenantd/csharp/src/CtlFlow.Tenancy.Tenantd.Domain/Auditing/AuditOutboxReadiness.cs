namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public enum AuditOutboxReadiness
{
    Ready = 1,
    CapacityExhausted = 2,
    PermanentlyBlocked = 3,
    Inconsistent = 4
}
