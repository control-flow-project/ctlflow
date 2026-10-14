namespace Crossfire.AdapterSqlite.Entities;

public class AgentNameRow
{
    public string Name { get; set; } = "";
    public string? RequestId { get; set; }
    public string? InstanceKey { get; set; }
    public string? AgentId { get; set; }
}
