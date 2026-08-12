using CtlFlow.Audit.V1;
using CtlFlow.Identity.Identityd.Domain.Auditing;

namespace CtlFlow.Identity.Identityd.Service.Auditing;

internal static partial class AuditDelivery
{
    private static CtlFlow.Audit.V1.AuditAttribution
        CreateAuditAttribution(
            Domain.Auditing.AuditAttribution attribution) =>
            attribution switch
            {
                Domain.Auditing.AuditAttribution.Workload workload => new()
                {
                    WorkloadSubject = workload.ImmediateCaller.Value
                },
                Domain.Auditing.AuditAttribution.Invocation invocation => new()
                {
                    Invocation = new InvocationAuditAttribution
                    {
                        ActorPrincipalId = invocation.Actor.Value,
                        AttachedAccountPrincipalId =
                            invocation.AttachedAccount.Value,
                        WorkloadSubject =
                            invocation.ImmediateCaller.Value
                    }
                },
                _ => throw new InvalidOperationException(
                    "Audit attribution is not supported")
            };
}
