namespace Crossfire.AdapterSqlite.Entities;

public class AgentWakeSenderRow
{
    public string AgentId { get; set; } = "";
    public string SenderPrincipalId { get; set; } = "";
    public long IncludeAgents { get; set; }
}
