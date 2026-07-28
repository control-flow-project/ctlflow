namespace CtlFlow.Configuration.Configd.IntegrationTests.Model;

internal sealed record SqliteIndex(
    bool Unique,
    IReadOnlyList<string> Columns)
{
    internal string Signature =>
        $"{(Unique ? "unique" : "index")}({string.Join(",", Columns)})";
}
