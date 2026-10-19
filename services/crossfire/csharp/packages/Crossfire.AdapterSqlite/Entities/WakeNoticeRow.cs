namespace Crossfire.AdapterSqlite.Entities;

public class WakeNoticeRow
{
    public string ReceiverAgentId { get; set; } = "";
    public string EventId { get; set; } = "";
    public string SenderBackendUserId { get; set; } = "";
    public string RoomId { get; set; } = "";
    public long ReservedAt { get; set; }
    public string MessageBody { get; set; } = "";
    public string Status { get; set; } = "";
    public long? SentAt { get; set; }
    public string? NativeEventId { get; set; }
    public long? NextAttemptAt { get; set; }
    public string? LastError { get; set; }
}
