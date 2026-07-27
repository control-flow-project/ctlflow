namespace CtlFlow.Audit.Auditd.Domain.Partitions;

public class AuditPartitionHead
{
    private AuditPartitionHead()
    {
        PartitionKey = null!;
    }

    internal AuditPartitionHead(
        string partitionKey,
        int partitionKind,
        string? tenantId,
        long currentCursor)
    {
        PartitionKey = partitionKey;
        PartitionKind = partitionKind;
        TenantId = tenantId;
        CurrentCursor = currentCursor;
    }

    internal string PartitionKey { get; private set; }

    internal int PartitionKind { get; private set; }

    internal string? TenantId { get; private set; }

    internal long CurrentCursor { get; private set; }

    internal long Advance()
    {
        if (CurrentCursor == long.MaxValue)
        {
            throw new Events.AuditCursorExhaustedException();
        }

        CurrentCursor++;
        return CurrentCursor;
    }
}
