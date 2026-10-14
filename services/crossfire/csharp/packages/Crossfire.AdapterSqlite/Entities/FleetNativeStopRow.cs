namespace Crossfire.AdapterSqlite.Entities;

public class FleetNativeStopRow
{
    public string AgentId { get; set; } = "";
    public string ReceiptId { get; set; } = "";
    public long Sequence { get; set; }
    public string FleetId { get; set; } = "";
    public string RunId { get; set; } = "";
    public string ConnectionId { get; set; } = "";
    public string CredentialId { get; set; } = "";
    public long NativeStoppedAt { get; set; }
    public long? InvalidatedAt { get; set; }
}
