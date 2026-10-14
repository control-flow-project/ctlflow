namespace Crossfire.AdapterSqlite.Entities;

public class MemberInvitationRow
{
    public string Id { get; set; } = "";
    public string CreatedByMemberId { get; set; } = "";
    public string ClaimHash { get; set; } = "";
    public string RoleCode { get; set; } = "";
    public string PrincipalKind { get; set; } = "";
    public long CreatedAt { get; set; }
    public long ExpiresAt { get; set; }
    public string? ConsumedByMemberId { get; set; }
    public long? RevokedAt { get; set; }
    public string? ClaimMatrixUserId { get; set; }
    public string? ClaimDisplayName { get; set; }
    public string? ClaimFingerprint { get; set; }
}
