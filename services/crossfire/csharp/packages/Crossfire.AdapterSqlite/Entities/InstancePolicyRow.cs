namespace Crossfire.AdapterSqlite.Entities;

public class InstancePolicyRow
{
    public string Id { get; set; } = "";
    public long Revision { get; set; }
    public long MaxOwnerAgents { get; set; }
    public long MaxAgents { get; set; }
    public long MaxPending { get; set; }
    public long EnrollmentSeconds { get; set; }
    public long ReconcileSeconds { get; set; }
    public long MaxMessageBytes { get; set; }
    public long FleetIdleTimeoutSeconds { get; set; }
    public string AgentInstructions { get; set; } = "";
    public string SignupMode { get; set; } = "";
    public string InvitationIssuers { get; set; } = "";
}
