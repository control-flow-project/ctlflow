namespace Crossfire.AdapterSqlite.Entities;

public class PrincipalRow
{
    public string Id { get; set; } = "";
    public string MatrixUserId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Status { get; set; } = "";
    public long Revision { get; set; }
    public long CreatedAt { get; set; }
}
