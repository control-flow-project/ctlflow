namespace CtlFlow.Audit.Auditd.Domain.Events;

public abstract class AuditDetail
{
    private protected AuditDetail()
    {
        EventKey = null!;
    }

    private protected AuditDetail(AuditDetailKind kind)
    {
        EventKey = null!;
        Kind = kind;
    }

    internal string EventKey { get; private set; }

    internal AuditDetailKind Kind { get; private set; }

    internal abstract void WriteCanonical(CanonicalHashWriter writer);

    internal void AttachTo(string eventKey)
    {
        if (EventKey is not null)
        {
            throw new InvalidOperationException(
                "Audit detail is already attached");
        }

        EventKey = eventKey;
    }
}
