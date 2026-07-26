namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public abstract record AuditAttribution
{
    private AuditAttribution()
    {
    }

    public sealed record Kubernetes(AuditText Subject) : AuditAttribution;

    public sealed record AttachedActor(
        AuditText ActorPrincipal,
        AuditText AttachedAccountPrincipal,
        AuditText ImmediateCaller) : AuditAttribution;
}
