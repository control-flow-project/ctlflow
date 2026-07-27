namespace CtlFlow.Audit.Auditd.Domain.Events;

public static partial class AuditRecords
{
    public static ValueTask ValidateAuditBatch(
        IReadOnlyList<AuditRecord> records,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(records);
        if (records.Count == 0)
        {
            throw new ArgumentException(
                "Audit batch must contain at least one event");
        }

        if (records.Count > 100)
        {
            throw new AuditBatchLimitException();
        }

        var eventIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var record in records)
        {
            ArgumentNullException.ThrowIfNull(record);
            if (!eventIds.Add(record.SourceEventId))
            {
                throw new ArgumentException(
                    "Source event identifiers must be unique");
            }
        }

        return ValueTask.CompletedTask;
    }
}
