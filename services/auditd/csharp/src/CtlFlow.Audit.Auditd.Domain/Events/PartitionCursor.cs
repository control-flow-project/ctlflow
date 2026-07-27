namespace CtlFlow.Audit.Auditd.Domain.Events;

public sealed record PartitionCursor
{
    private PartitionCursor(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static PartitionCursor FromAcceptance(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Partition cursor must be positive");
        }

        return new PartitionCursor(value);
    }

    public static PartitionCursor FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored partition cursor must be positive");
        }

        return new PartitionCursor(value);
    }
}
