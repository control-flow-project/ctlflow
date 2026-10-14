namespace Crossfire.AdapterSqlite.Entities;

public class PrincipalApplicationRow
{
    public string PrincipalId { get; set; } = "";
    public long? AppliedRevision { get; set; }
    public string? AppliedIntentHash { get; set; }
    public string? AppliedStatus { get; set; }
    public string? NativeDisplayName { get; set; }
    public long? LastAttemptAt { get; set; }
    public long? LastSuccessAt { get; set; }
    public long NextCheckAt { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
}
