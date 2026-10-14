namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeUsageCheckpointRow
{
    public string AgentId { get; set; } = "";
    public string Runtime { get; set; } = "";
    public string SessionId { get; set; } = "";
    public long Input { get; set; }
    public long CachedInput { get; set; }
    public long? CacheWriteInput { get; set; }
    public long Output { get; set; }
    public long? ReasoningOutput { get; set; }
    public long Total { get; set; }
    public long CapturedAt { get; set; }
}
