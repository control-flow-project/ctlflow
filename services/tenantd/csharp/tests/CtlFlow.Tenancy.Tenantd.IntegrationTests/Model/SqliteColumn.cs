namespace CtlFlow.Tenancy.Tenantd.IntegrationTests.Model;

internal sealed record SqliteColumn(
    string Name,
    string Affinity,
    bool Required,
    int PrimaryKeyOrder);
