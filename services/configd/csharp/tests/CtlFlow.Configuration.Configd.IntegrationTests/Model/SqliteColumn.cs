namespace CtlFlow.Configuration.Configd.IntegrationTests.Model;

internal sealed record SqliteColumn(
    string Name,
    string Affinity,
    bool Required,
    int PrimaryKeyOrder);
