namespace Crossfire.AdapterSqlite.Entities;

public class FleetInstancePolicyRow
{
    public string AgentId { get; set; } = "";
    public string ApprovedByMemberId { get; set; } = "";
    public long ApprovedAt { get; set; }
}
