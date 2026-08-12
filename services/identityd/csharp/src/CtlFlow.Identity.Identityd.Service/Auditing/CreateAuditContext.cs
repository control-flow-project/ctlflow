using System.Diagnostics;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Time;
using CtlFlow.Identity.Identityd.Service.Security;

namespace CtlFlow.Identity.Identityd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static ValueTask<AuditContext> CreateAuditContext(
        IdentityRequestIdentity identity,
        Activity? activity,
        DateTimeOffset occurredAt,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (activity is null
            || activity.TraceId == default
            || activity.SpanId == default)
        {
            throw new InvalidOperationException(
                "An audited operation requires trace correlation");
        }

        var immediateCaller = AuditCaller.Parse(
            identity.ImmediateCaller.Value);
        AuditAttribution attribution = identity.Invocation is null
            ? new AuditAttribution.Workload(immediateCaller)
            : new AuditAttribution.Invocation(
                identity.Invocation.Actor,
                identity.Invocation.SubjectAccount,
                immediateCaller);
        return ValueTask.FromResult(new AuditContext(
            attribution,
            new AuditCorrelation(
                activity.TraceId.ToHexString(),
                activity.SpanId.ToHexString()),
            UtcInstant.FromClock(occurredAt)));
    }
}
