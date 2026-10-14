namespace Crossfire.AdapterSqlite.Entities;

public class WakeRuleRow
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string ConfiguredById { get; set; } = "";
    public string Name { get; set; } = "";
    public string Message { get; set; } = "";
    public string ScheduleKind { get; set; } = "";
    public long? IntervalSeconds { get; set; }
    public string? CronExpression { get; set; }
    public string? TimeZone { get; set; }
    public long Enabled { get; set; }
    public long Revision { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}
