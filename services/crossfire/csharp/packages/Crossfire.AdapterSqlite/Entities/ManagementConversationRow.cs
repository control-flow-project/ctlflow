namespace Crossfire.AdapterSqlite.Entities;

public class ManagementConversationRow
{
    public string OwnerId { get; set; } = "";
    public string RoomId { get; set; } = "";
    public long CreatedAt { get; set; }
}
