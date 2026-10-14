namespace Crossfire.AdapterSqlite.Entities;

public class EnrollmentRequestRow
{
    public string ControllerName { get; set; } = "";
    public string ControllerCredentialHash { get; set; } = "";
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string FleetKey { get; set; } = "";
    public string VerificationCode { get; set; } = "";
    public string ClaimHash { get; set; } = "";
    public string RosterDigest { get; set; } = "";
    public string Status { get; set; } = "";
    public long Revision { get; set; }
    public long CreatedAt { get; set; }
    public long ExpiresAt { get; set; }
    public string? DecidedByMemberId { get; set; }
    public long? DecidedAt { get; set; }
}
