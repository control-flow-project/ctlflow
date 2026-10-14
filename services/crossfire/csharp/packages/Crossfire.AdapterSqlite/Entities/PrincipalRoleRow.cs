namespace Crossfire.AdapterSqlite.Entities;

public class PrincipalRoleRow
{
    public string PrincipalId { get; set; } = "";
    public string PrincipalKind { get; set; } = "";
    public string RoleCode { get; set; } = "";
    public string? AssignedByMemberId { get; set; }
    public long AssignedAt { get; set; }
}
