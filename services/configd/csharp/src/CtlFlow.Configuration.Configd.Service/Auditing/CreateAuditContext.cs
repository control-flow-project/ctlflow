using System.Diagnostics;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Time;
using CtlFlow.Configuration.Configd.Service.Security;

namespace CtlFlow.Configuration.Configd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static ValueTask<AuditContext> CreateAuditContext(
        ConfigRequestIdentity identity,
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

        AuditAttribution attribution = identity.Admission switch
        {
            ConfigAdmission.Operator => new AuditAttribution.Operator(
                AuditSubject.Parse(
                    identity.ImmediateCaller.Value,
                    253)),
            ConfigAdmission.Capability when identity.Invocation is not null =>
                new AuditAttribution.Invocation(
                    AuditSubject.Parse(
                        identity.Invocation.Actor.Value,
                        256),
                    AuditSubject.Parse(
                        identity.Invocation.SubjectAccount.Value,
                        256),
                    AuditSubject.Parse(
                        identity.ImmediateCaller.Value,
                        253)),
            ConfigAdmission.Provisioner or ConfigAdmission.Execd =>
                new AuditAttribution.Workload(
                    AuditSubject.Parse(
                        identity.ImmediateCaller.Value,
                        253)),
            _ => throw new InvalidOperationException(
                "Audit attribution is invalid")
        };
        return ValueTask.FromResult(new AuditContext(
            attribution,
            AuditTraceId.Parse(activity.TraceId.ToHexString()),
            AuditSpanId.Parse(activity.SpanId.ToHexString()),
            UtcInstant.FromClock(occurredAt)));
    }
}
