namespace Crossfire.AdapterSqlite.Entities;

public class FleetRuntimeOperationRow
{
    public string Id { get; set; } = "";
    public string FleetId { get; set; } = "";
    public string? AgentId { get; set; }
    public string AuthorPrincipalId { get; set; } = "";
    public string Action { get; set; } = "";
    public long ExpectedRevision { get; set; }
    public string Status { get; set; } = "";
    public long CreatedAt { get; set; }
    public long? CompletedAt { get; set; }
    public string? ErrorMessage { get; set; }
    public string? ConnectionId { get; set; }
    public string? CredentialId { get; set; }
}
