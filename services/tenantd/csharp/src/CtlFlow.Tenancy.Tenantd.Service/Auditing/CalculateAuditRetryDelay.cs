using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static TimeSpan CalculateAuditRetryDelay(
        AuditOutboxLease lease,
        AuditSettings settings)
    {
        var attempt = lease.Events.Max(value => value.DeliveryAttempt.Value);
        var exponent = Math.Min(attempt - 1, 20);
        var multiplier = 1L << exponent;
        var milliseconds = Math.Min(
            settings.RetryBaseDelay.TotalMilliseconds * multiplier,
            settings.RetryMaximumDelay.TotalMilliseconds);
        return TimeSpan.FromMilliseconds(milliseconds);
    }
}
