namespace Crossfire.AdapterSqlite.Entities;

public class FleetMessageDeliveryRow
{
    public string MessageId { get; set; } = "";
    public string AgentId { get; set; } = "";
    public string Status { get; set; } = "";
    public long? CompletedAt { get; set; }
    public string? ErrorMessage { get; set; }
}
