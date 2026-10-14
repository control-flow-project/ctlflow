namespace Crossfire.AdapterSqlite.Entities;

public class ListenerStatUsageRow
{
    public string RunId { get; set; } = "";
    public long BucketAt { get; set; }
    public string Runtime { get; set; } = "";
    public string SessionId { get; set; } = "";
    public long Input { get; set; }
    public long CachedInput { get; set; }
    public long? CacheWriteInput { get; set; }
    public long Output { get; set; }
    public long? ReasoningOutput { get; set; }
    public long Total { get; set; }
}
