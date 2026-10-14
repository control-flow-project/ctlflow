namespace Crossfire.AdapterSqlite.Entities;

public class AgentCredentialRow
{
    public string AgentId { get; set; } = "";
    public string ProvisioningPassword { get; set; } = "";
    public string? AccessToken { get; set; }
    public long UpdatedAt { get; set; }
}
