namespace Crossfire.AdapterSqlite.Entities;

public class ListenerRunRow
{
    public string? ControllerFleetId { get; set; }
    public string? ControllerConnectionId { get; set; }
    public string? ControllerCredentialId { get; set; }
    public string Id { get; set; } = "";
    public string AgentId { get; set; } = "";
    public string? Release { get; set; }
    public long StartedAt { get; set; }
    public long LastSeenAt { get; set; }
    public long ActiveMs { get; set; }
    public long MessagesDelivered { get; set; }
    public long? StoppedAt { get; set; }
    public long? DisconnectRequestedAt { get; set; }
}
