using System.Diagnostics;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Security;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static ValueTask<AuditContext> CreateAuditContext(
        TenantRequestIdentity identity,
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
            ? new AuditAttribution.Kubernetes(AuditText.Parse(
                identity.ImmediateCaller.Value,
                253,
                "Kubernetes subject"))
            : new AuditAttribution.AttachedActor(
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
