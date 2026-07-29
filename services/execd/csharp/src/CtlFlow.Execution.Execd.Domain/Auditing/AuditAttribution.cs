namespace CtlFlow.Execution.Execd.Domain.Auditing;

public abstract record AuditAttribution
{
    private AuditAttribution()
    {
    }

    public sealed record Operator(AuditText CommonName) : AuditAttribution;

    public sealed record Invocation(
        AuditText ActorPrincipal,
        AuditText AttachedAccountPrincipal,
        AuditText WorkloadSubject) : AuditAttribution;
}
