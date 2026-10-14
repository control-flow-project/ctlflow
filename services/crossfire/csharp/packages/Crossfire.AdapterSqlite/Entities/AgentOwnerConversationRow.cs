namespace Crossfire.AdapterSqlite.Entities;

public class AgentOwnerConversationRow
{
    public string AgentId { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string RoomId { get; set; } = "";
    public long CreatedAt { get; set; }
}
