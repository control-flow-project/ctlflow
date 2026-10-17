namespace Crossfire.AdapterSqlite;

public static class SchemaContract
{
    public const long ApplicationId = 1129465426;
    public const long Version = 18;
    public static readonly string[] Migrations = ["20261014000000_initial_schema.mjs", "20261014000001_initial_data.mjs", "20261018000000_listener_activity_index.mjs"];
}
