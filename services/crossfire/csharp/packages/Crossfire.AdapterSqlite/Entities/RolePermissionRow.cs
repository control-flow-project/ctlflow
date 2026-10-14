namespace Crossfire.AdapterSqlite.Entities;

public class RolePermissionRow
{
    public string RoleCode { get; set; } = "";
    public string PermissionCode { get; set; } = "";
    public string GrantScope { get; set; } = "";
}
