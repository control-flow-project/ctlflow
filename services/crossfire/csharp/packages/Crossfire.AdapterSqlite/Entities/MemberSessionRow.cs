namespace Crossfire.AdapterSqlite.Entities;

public class MemberSessionRow
{
    public string SecretHash { get; set; } = "";
    public string MemberId { get; set; } = "";
    public string CsrfSecret { get; set; } = "";
    public string NativeAccessToken { get; set; } = "";
    public long CreatedAt { get; set; }
    public long ExpiresAt { get; set; }
}
