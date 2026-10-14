namespace Crossfire.AdapterSqlite.Entities;

public class AgentRoomPermissionRow
{
    public string AgentId { get; set; } = "";
    public string RoomId { get; set; } = "";
    public string Generation { get; set; } = "";
    public string PermissionCode { get; set; } = "";
    public string GrantScope { get; set; } = "";
    public string GrantedByMemberId { get; set; } = "";
    public long GrantedAt { get; set; }
}
