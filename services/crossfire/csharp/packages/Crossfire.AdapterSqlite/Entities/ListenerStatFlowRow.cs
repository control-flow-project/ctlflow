namespace Crossfire.AdapterSqlite.Entities;

public class ListenerStatFlowRow
{
    public string RunId { get; set; } = "";
    public long BucketAt { get; set; }
    public string RoomId { get; set; } = "";
    public string SenderMatrixId { get; set; } = "";
    public string MessageType { get; set; } = "";
    public long Observed { get; set; }
    public long Delivered { get; set; }
    public long ContentBytes { get; set; }
    public long DeliveredBytes { get; set; }
    public long AttachmentBytes { get; set; }
    public long LargestBytes { get; set; }
}
