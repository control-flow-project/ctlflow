namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeSettingRow
{
    public string RunId { get; set; } = "";
    public string SessionId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? ConfiguredValue { get; set; }
    public string? EffectiveValue { get; set; }
}
