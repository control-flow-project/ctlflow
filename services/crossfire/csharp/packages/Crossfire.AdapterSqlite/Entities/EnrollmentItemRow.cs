namespace Crossfire.AdapterSqlite.Entities;

public class EnrollmentItemRow
{
    public string RequestId { get; set; } = "";
    public string InstanceKey { get; set; } = "";
    public string RequestedName { get; set; } = "";
    public string Outcome { get; set; } = "";
    public string? AgentId { get; set; }
}
