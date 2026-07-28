using System.Diagnostics;
using CtlFlow.Packages.Pkgd.Domain.Auditing;
using CtlFlow.Packages.Pkgd.Domain.Time;
using CtlFlow.Packages.Pkgd.Service.Security;

namespace CtlFlow.Packages.Pkgd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static ValueTask<AuditContext> CreateAuditContext(
        PackageRequestIdentity identity,
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

        AuditAttribution attribution = identity.Invocation is null
            ? new AuditAttribution.Operator(AuditText.Parse(
                identity.ImmediateCaller.Value,
                253,
                "operator common name"))
            : new AuditAttribution.Invocation(
                AuditText.Parse(
                    identity.Invocation.Actor.Value,
                    256,
                    "actor principal"),
                AuditText.Parse(
                    identity.Invocation.SubjectAccount.Value,
                    256,
                    "attached account principal"),
                AuditText.Parse(
                    identity.ImmediateCaller.Value,
                    253,
                    "immediate caller"));
        return ValueTask.FromResult(new AuditContext(
            attribution,
            new AuditCorrelation(
                activity.TraceId.ToHexString(),
                activity.SpanId.ToHexString()),
            UtcInstant.FromClock(occurredAt)));
    }
}
