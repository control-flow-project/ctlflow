namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeIncidentRow
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string? AgentId { get; set; }
    public string? FleetId { get; set; }
    public string? RunId { get; set; }
    public string? SessionId { get; set; }
    public string Kind { get; set; } = "";
    public string Message { get; set; } = "";
    public long CreatedAt { get; set; }
    public long? RecoveredAt { get; set; }
}
