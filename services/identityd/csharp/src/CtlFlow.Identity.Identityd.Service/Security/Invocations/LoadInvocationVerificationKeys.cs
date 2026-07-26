using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using static CtlFlow.Identity.Identityd.Db.Keys.VerificationKeys;
using static CtlFlow.Identity.Identityd.Service.Security.Tokens.JsonWebKeys;

namespace CtlFlow.Identity.Identityd.Service.Security.Invocations;

internal static partial class InvocationVerificationKeys
{
    internal static async Task<VerificationKeySnapshot>
        LoadInvocationVerificationKeys(
            IdentityDatabase identityDatabase,
            TimeSpan cacheLifetime,
            CancellationToken cancellation)
    {
        try
        {
            var keySet = await GetInvocationVerificationKeys(
                identityDatabase,
                cancellation);
            var keys = new Dictionary<string, RsaVerificationKey>(
                StringComparer.Ordinal);
            foreach (var key in keySet.Keys)
            {
                if (!keys.TryAdd(
                        key.KeyId.Value,
                        CreateRsaVerificationKey(
                            key.Modulus.Value,
                            key.Exponent.Value)))
                {
                    throw new InvalidOperationException(
                        "Verification key IDs are not unique");
                }
            }

            return new VerificationKeySnapshot(
                keys,
                DateTimeOffset.UtcNow.Add(cacheLifetime));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is IOException
                or InvalidDataException
                or InvalidOperationException)
        {
            throw new TokenKeySourceException(exception);
        }
    }
}
