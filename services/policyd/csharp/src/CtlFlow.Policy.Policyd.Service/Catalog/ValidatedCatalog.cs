namespace CtlFlow.Policy.Policyd.Service.Catalog;

internal sealed class ValidatedCatalog
{
    internal static readonly ValidatedCatalog Instance = new();

    private ValidatedCatalog()
    {
    }
}
