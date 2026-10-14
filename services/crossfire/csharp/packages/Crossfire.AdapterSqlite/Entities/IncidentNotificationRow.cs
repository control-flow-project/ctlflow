namespace Crossfire.AdapterSqlite.Entities;

public class IncidentNotificationRow
{
    public string IncidentId { get; set; } = "";
    public string Phase { get; set; } = "";
    public string Body { get; set; } = "";
    public long NextAttemptAt { get; set; }
    public string? EventId { get; set; }
}
