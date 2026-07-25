using System.Security.Cryptography;

namespace CtlFlow.Tenancy.Tenantd.Db.Identifiers;

internal static class StorageIdentifiers
{
    internal static string CreateStorageId(string prefix)
    {
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        return $"{prefix}_{Convert.ToHexString(bytes).ToLowerInvariant()}";
    }
}
