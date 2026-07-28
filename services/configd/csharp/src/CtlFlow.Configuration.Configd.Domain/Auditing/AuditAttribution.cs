namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public abstract record AuditAttribution
{
    private AuditAttribution()
    {
    }

    public sealed record Operator(AuditSubject CommonName) : AuditAttribution;

    public sealed record Workload(AuditSubject Subject) : AuditAttribution;

    public sealed record Invocation(
        AuditSubject ActorPrincipal,
        AuditSubject AttachedAccountPrincipal,
        AuditSubject WorkloadSubject) : AuditAttribution;
}
