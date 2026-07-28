using CtlFlow.Policy.Policyd.Domain.Catalog;

namespace CtlFlow.Policy.Policyd.Service.Catalog;

internal static partial class Catalogs
{
    internal static async Task<ValidatedCatalog> LoadOperationCatalog(
        string path,
        CancellationToken cancellation)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length is < 1 or > 8_192)
            {
                throw new InvalidDataException(
                    "Operation catalog has an invalid size");
            }
            var lines = await File.ReadAllLinesAsync(path, cancellation);
            var expected = OperationCatalog.ReadCatalogEntries();
            if (lines.Length != expected.Count)
            {
                throw new InvalidDataException(
                    "Operation catalog has an invalid entry count");
            }
            for (var index = 0; index < expected.Count; index++)
            {
                var entry = expected[index];
                var expectedLine =
                    $"{entry.Operation.Value}\t{OwnerPrincipal(entry.Owner)}";
                if (!string.Equals(
                        lines[index],
                        expectedLine,
                        StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        "Operation catalog does not match the checked contract");
                }
            }
            return ValidatedCatalog.Instance;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException
                or InvalidDataException)
        {
            throw new CatalogUnavailableException(exception);
        }
    }

    private static string OwnerPrincipal(OperationOwner owner) =>
        owner switch
        {
            OperationOwner.Tenantd => "SERVICE/svc_tenantd",
            OperationOwner.Pkgd => "SERVICE/svc_pkgd",
            OperationOwner.Configd => "SERVICE/svc_configd",
            OperationOwner.Execd => "SERVICE/svc_execd",
            _ => throw new InvalidOperationException(
                "Operation owner is invalid")
        };
}
