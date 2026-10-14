namespace Crossfire.AdapterSqlite.Entities;

public class FleetRow
{
    public long? ArchivedAt { get; set; }
    public string Id { get; set; } = "";
    public long DeliveryEnabled { get; set; }
    public string Label { get; set; } = "";
    public string ControllerName { get; set; } = "";
    public long Revision { get; set; }
    public long UpdatedAt { get; set; }
    public string OwnerId { get; set; } = "";
    public string FleetKey { get; set; } = "";
    public long CreatedAt { get; set; }
}
