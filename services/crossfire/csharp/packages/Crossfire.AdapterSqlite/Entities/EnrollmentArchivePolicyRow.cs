namespace Crossfire.AdapterSqlite.Entities;

public class EnrollmentArchivePolicyRow
{
    public string RequestId { get; set; } = "";
    public string InstanceKey { get; set; } = "";
    public string WakeMode { get; set; } = "";
    public long? ExpectedAgentRevision { get; set; }
}
