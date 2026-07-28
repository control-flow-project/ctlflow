namespace CtlFlow.Policy.Policyd.IntegrationTests.Model;

internal sealed record SqliteTable(
    string Name,
    IReadOnlyDictionary<string, SqliteColumn> Columns,
    IReadOnlyList<SqliteForeignKey> ForeignKeys,
    IReadOnlyList<SqliteIndex> Indexes);
