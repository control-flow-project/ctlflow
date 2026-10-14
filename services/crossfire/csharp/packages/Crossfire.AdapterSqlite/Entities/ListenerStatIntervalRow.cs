namespace Crossfire.AdapterSqlite.Entities;

public class ListenerStatIntervalRow
{
    public string RunId { get; set; } = "";
    public long BucketAt { get; set; }
    public string AgentId { get; set; } = "";
    public long StartedAt { get; set; }
    public long EndedAt { get; set; }
    public long CapturedAt { get; set; }
    public long Dropped { get; set; }
}
