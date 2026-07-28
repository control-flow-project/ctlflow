namespace CtlFlow.Policy.Policyd.Service.Catalog;

internal sealed class CatalogUnavailableException(Exception innerException)
    : Exception("Operation catalog is unavailable", innerException);
