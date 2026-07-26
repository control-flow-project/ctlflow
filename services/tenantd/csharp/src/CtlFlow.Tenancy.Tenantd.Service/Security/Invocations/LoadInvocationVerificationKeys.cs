using CtlFlow.Identity.V1;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Tokens.JsonWebKeys;

namespace CtlFlow.Tenancy.Tenantd.Service.Security.Invocations;

internal static partial class InvocationVerificationKeys
{
    internal static async Task<VerificationKeySnapshot>
        LoadInvocationVerificationKeys(
            IdentityService.IdentityServiceClient client,
            IdentitySettings settings,
            CancellationToken cancellation)
    {
        try
        {
            var token = (await File.ReadAllTextAsync(
                settings.WorkloadTokenFilePath,
                cancellation)).Trim();
            if (token.Length is < 1 or > 16_384)
            {
                throw new InvalidDataException(
                    "The identity workload token is invalid");
            }

            var headers = new Metadata
            {
                { "authorization", $"Bearer {token}" }
            };
            var response = await client.GetInvocationVerificationKeysAsync(
                new GetInvocationVerificationKeysRequest(),
                headers,
                DateTime.UtcNow.Add(settings.CallTimeout),
                cancellation);
            return CreateSnapshot(response, DateTimeOffset.UtcNow);
        }
        catch (TokenKeySourceException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is IOException
                or InvalidDataException
                or InvalidOperationException
                or RpcException)
        {
            throw new TokenKeySourceException(exception);
        }
    }

    private static VerificationKeySnapshot CreateSnapshot(
        GetInvocationVerificationKeysResponse response,
        DateTimeOffset receivedAt)
    {
        if (response.Keys.Count is < 1 or > 8
            || response.ExpiresAt is null)
        {
            throw new InvalidDataException(
                "identityd returned an invalid verification-key response");
        }

        var expiresAt = response.ExpiresAt.ToDateTimeOffset();
        if (expiresAt <= receivedAt
            || expiresAt > receivedAt.AddMinutes(5))
        {
            throw new InvalidDataException(
                "identityd returned an invalid verification-key expiry");
        }

        var keys = new Dictionary<string, RsaVerificationKey>(
            StringComparer.Ordinal);
        foreach (var key in response.Keys)
        {
            if (key.Algorithm != "RS256"
                || !IsKeyId(key.KeyId)
                || !keys.TryAdd(
                    key.KeyId,
                    CreateRsaVerificationKey(
                        key.ModulusBase64Url,
                        key.ExponentBase64Url)))
            {
                throw new InvalidDataException(
                    "identityd returned an invalid verification key");
            }
        }

        return new VerificationKeySnapshot(keys, expiresAt);
    }

    private static bool IsKeyId(string value) =>
        value.Length is >= 1 and <= 128
        && value.All(character => character is >= '!' and <= '~');
}
