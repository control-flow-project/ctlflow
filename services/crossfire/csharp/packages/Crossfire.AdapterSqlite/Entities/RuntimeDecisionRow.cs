namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeDecisionRow
{
    public string Id { get; set; } = "";
    public string AgentId { get; set; } = "";
    public string RunId { get; set; } = "";
    public string Runtime { get; set; } = "";
    public string SessionId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string TurnId { get; set; } = "";
    public string ItemId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Action { get; set; } = "";
    public string ReviewText { get; set; } = "";
    public long Blocking { get; set; }
    public long? ExpiresAt { get; set; }
    public long CreatedAt { get; set; }
    public string Status { get; set; } = "";
}
