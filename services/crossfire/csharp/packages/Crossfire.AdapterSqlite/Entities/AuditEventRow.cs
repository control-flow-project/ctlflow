namespace Crossfire.AdapterSqlite.Entities;

public class AuditEventRow
{
    public string Id { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string? ActorCredentialId { get; set; }
    public string ActorKind { get; set; } = "";
    public string? ActorPrincipalId { get; set; }
    public string? OwnerId { get; set; }
    public string TargetKind { get; set; } = "";
    public string TargetId { get; set; } = "";
    public string? RoomId { get; set; }
    public string? MembershipGeneration { get; set; }
    public string? AuthorizerId { get; set; }
    public string? AddedById { get; set; }
    public string? PermissionCode { get; set; }
    public string Action { get; set; } = "";
    public string Outcome { get; set; } = "";
    public string Message { get; set; } = "";
    public long CreatedAt { get; set; }
}
