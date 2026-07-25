using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditCorrelations
{
    internal static async ValueTask<AuditCorrelation> CreateAuditCorrelation(
        Activity? activity,
        CancellationToken cancellation)
    {
        if (activity is null)
        {
            throw new InvalidOperationException(
                "An active request trace is required for an audited mutation");
        }

        var traceId = await AuditTraceId.Parse(
            activity.TraceId.ToHexString(),
            cancellation);
        var spanId = await AuditSpanId.Parse(
            activity.SpanId.ToHexString(),
            cancellation);
        return new AuditCorrelation(traceId, spanId);
    }
}
