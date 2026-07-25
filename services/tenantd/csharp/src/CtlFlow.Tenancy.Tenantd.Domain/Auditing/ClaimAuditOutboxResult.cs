namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public abstract record ClaimAuditOutboxResult
{
    private ClaimAuditOutboxResult()
    {
    }

    public sealed record Empty : ClaimAuditOutboxResult;

    public sealed record Claimed(AuditOutboxLease Lease)
        : ClaimAuditOutboxResult;
}
