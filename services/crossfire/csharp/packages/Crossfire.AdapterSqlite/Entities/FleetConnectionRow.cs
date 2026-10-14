namespace Crossfire.AdapterSqlite.Entities;

public class FleetConnectionRow
{
    public string FleetId { get; set; } = "";
    public string ConnectionId { get; set; } = "";
    public string CredentialId { get; set; } = "";
    public long LastSeenAt { get; set; }
    public long ExpiresAt { get; set; }
    public long? ClosedAt { get; set; }
}
