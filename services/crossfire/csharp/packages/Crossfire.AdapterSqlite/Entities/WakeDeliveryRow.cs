namespace Crossfire.AdapterSqlite.Entities;

public class WakeDeliveryRow
{
    public string Id { get; set; } = "";
    public string RuleId { get; set; } = "";
    public string AgentId { get; set; } = "";
    public long RuleRevision { get; set; }
    public string RunId { get; set; } = "";
    public string SessionId { get; set; } = "";
    public long ScheduledAt { get; set; }
    public long CreatedAt { get; set; }
    public string Status { get; set; } = "";
    public long? DeliveredAt { get; set; }
}
