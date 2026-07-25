namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public enum AuditDeliveryFailureCode
{
    ConflictingReplay = 1,
    InvalidEnvelope = 2,
    SourceNotAdmitted = 3,
    InvalidAcceptance = 4
}
