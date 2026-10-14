namespace Crossfire.AdapterSqlite.Entities;

public class ListenerStatCheckpointRow
{
    public string RunId { get; set; } = "";
    public long Sequence { get; set; }
    public string Digest { get; set; } = "";
    public long CapturedAt { get; set; }
}
