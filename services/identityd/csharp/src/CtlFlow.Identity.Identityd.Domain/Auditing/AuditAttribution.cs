using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public abstract record AuditAttribution
{
    private AuditAttribution()
    {
    }

    public sealed record Workload(AuditCaller ImmediateCaller)
        : AuditAttribution;

    public sealed record Invocation(
        PrincipalId Actor,
        AccountId AttachedAccount,
        AuditCaller ImmediateCaller)
        : AuditAttribution;
}
