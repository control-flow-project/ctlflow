namespace Crossfire.AdapterSqlite.Entities;

public class AgentRoomGrantRow
{
    public string AgentId { get; set; } = "";
    public string RoomId { get; set; } = "";
    public string Generation { get; set; } = "";
    public string AuthorizerId { get; set; } = "";
    public string AddedById { get; set; } = "";
    public string? InvitationEventId { get; set; }
    public string AdmissionKind { get; set; } = "";
    public string AccessMode { get; set; } = "";
    public string? NativeAccess { get; set; }
    public long Muted { get; set; }
    public long Revision { get; set; }
    public long AccessRevision { get; set; }
    public long UpdatedAt { get; set; }
}
