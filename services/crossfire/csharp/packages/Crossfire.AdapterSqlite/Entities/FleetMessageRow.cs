namespace Crossfire.AdapterSqlite.Entities;

public class FleetMessageRow
{
    public string Id { get; set; } = "";
    public string FleetId { get; set; } = "";
    public string? AuthorPrincipalId { get; set; }
    public string? AuthorCredentialId { get; set; }
    public string Body { get; set; } = "";
    public long CreatedAt { get; set; }
    public long ExpiresAt { get; set; }
}
