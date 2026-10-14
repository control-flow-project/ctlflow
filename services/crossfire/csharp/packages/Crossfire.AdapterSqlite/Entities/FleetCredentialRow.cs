namespace Crossfire.AdapterSqlite.Entities;

public class FleetCredentialRow
{
    public string Id { get; set; } = "";
    public string FleetId { get; set; } = "";
    public string SecretHash { get; set; } = "";
    public long CreatedAt { get; set; }
    public long? RevokedAt { get; set; }
}
