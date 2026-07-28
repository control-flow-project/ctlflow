using CtlFlow.Policy.Policyd.Db.Providers;
using CtlFlow.Policy.Policyd.Db.Schema;
using CtlFlow.Policy.Policyd.Service.Configuration;
using static CtlFlow.Policy.Policyd.Db.Schema.Schemas;
using static CtlFlow.Policy.Policyd.Service.Catalog.Catalogs;
using static CtlFlow.Policy.Policyd.Service.Security.Tokens.JsonWebKeys;

namespace CtlFlow.Policy.Policyd.Service.Hosting;

internal static partial class PolicydProcess
{
    private static async Task<bool> VerifyReadiness(
        ServiceSettings settings,
        PolicyDatabase database,
        CancellationToken cancellation)
    {
        if (await VerifySchema(database, cancellation)
            != SchemaCompatibility.Compatible)
        {
            return false;
        }

        await LoadOperationCatalog(settings.CatalogPath, cancellation);
        await LoadFileVerificationKeys(
            settings.WorkloadTokens.VerificationKeySetPath,
            settings.WorkloadTokens.KeyCacheLifetime,
            cancellation);
        var workloadToken = (await File.ReadAllTextAsync(
            settings.Identity.WorkloadTokenFilePath,
            cancellation)).Trim();
        return workloadToken.Length is >= 1 and <= 16_384;
    }
}
