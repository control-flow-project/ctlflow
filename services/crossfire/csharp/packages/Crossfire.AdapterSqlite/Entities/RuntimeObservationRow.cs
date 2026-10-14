namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeObservationRow
{
    public string RunId { get; set; } = "";
    public string AgentId { get; set; } = "";
    public string SessionId { get; set; } = "";
    public string? RoomId { get; set; }
    public string Runtime { get; set; } = "";
    public string State { get; set; } = "";
    public long ObservedAt { get; set; }
    public string HistoryMode { get; set; } = "";
    public long MaxInputBytes { get; set; }
    public string? ErrorMessage { get; set; }
    public long? LastActivityAt { get; set; }
    public long? HistoryAvailable { get; set; }
}
