namespace Crossfire.AdapterSqlite.Entities;

public class PublicationRow
{
    public string Id { get; set; } = "";
    public string AgentId { get; set; } = "";
    public string PublicKey { get; set; } = "";
    public string Title { get; set; } = "";
    public string State { get; set; } = "";
    public long Revision { get; set; }
    public long CreatedAt { get; set; }
    public long ExpiresAt { get; set; }
    public long? PublishedAt { get; set; }
    public long? DeletedAt { get; set; }
    public long? CleanedAt { get; set; }
    public long TotalBytes { get; set; }
    public long FileCount { get; set; }
}
