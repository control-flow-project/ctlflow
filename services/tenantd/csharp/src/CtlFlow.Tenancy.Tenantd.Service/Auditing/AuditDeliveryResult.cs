using CtlFlow.Tenancy.Tenantd.Domain.Auditing;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal abstract record AuditDeliveryResult
{
    private AuditDeliveryResult()
    {
    }

    internal sealed record Accepted : AuditDeliveryResult;

    internal sealed record TransientFailure : AuditDeliveryResult;

    internal sealed record PermanentFailure(
        AuditDeliveryFailureCode FailureCode) : AuditDeliveryResult;
}
