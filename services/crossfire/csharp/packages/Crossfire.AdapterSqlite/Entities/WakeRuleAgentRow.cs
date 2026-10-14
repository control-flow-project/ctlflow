namespace Crossfire.AdapterSqlite.Entities;

public class WakeRuleAgentRow
{
    public string RuleId { get; set; } = "";
    public string AgentId { get; set; } = "";
    public long NextDueAt { get; set; }
    public long? LastDeliveredAt { get; set; }
}
