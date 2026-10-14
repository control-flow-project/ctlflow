namespace Crossfire.AdapterSqlite.Entities;

public class RoomGrantApplicationRow
{
    public string AgentId { get; set; } = "";
    public string RoomId { get; set; } = "";
    public string? ObservedGeneration { get; set; }
    public long? AppliedRevision { get; set; }
    public long? AppliedAccessRevision { get; set; }
    public string? Membership { get; set; }
    public long? PowerLevel { get; set; }
    public long Creator { get; set; }
    public long? LastAttemptAt { get; set; }
    public long? LastSuccessAt { get; set; }
    public long NextCheckAt { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
}
