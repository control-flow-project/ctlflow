namespace Crossfire.AdapterSqlite.Entities;

public class FleetInstanceRow
{
    public long? RetiredAt { get; set; }
    public string OwnerId { get; set; } = "";
    public string FleetKey { get; set; } = "";
    public string InstanceKey { get; set; } = "";
    public string AgentId { get; set; } = "";
}
