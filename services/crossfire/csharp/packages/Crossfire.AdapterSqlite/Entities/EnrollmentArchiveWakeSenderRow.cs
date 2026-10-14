namespace Crossfire.AdapterSqlite.Entities;

public class EnrollmentArchiveWakeSenderRow
{
    public string RequestId { get; set; } = "";
    public string InstanceKey { get; set; } = "";
    public string SenderPrincipalId { get; set; } = "";
    public long IncludeAgents { get; set; }
}
