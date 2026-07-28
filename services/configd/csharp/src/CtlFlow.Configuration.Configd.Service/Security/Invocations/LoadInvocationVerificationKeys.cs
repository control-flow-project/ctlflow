using CtlFlow.Identity.V1;
using CtlFlow.Configuration.Configd.Service.Configuration;
using CtlFlow.Configuration.Configd.Service.Security.Tokens;
using Grpc.Core;
using static CtlFlow.Configuration.Configd.Service.Security.Tokens.JsonWebKeys;

namespace CtlFlow.Configuration.Configd.Service.Security.Invocations;

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
            var deadline = DateTime.UtcNow.Add(settings.CallTimeout);
            var response = await FetchInvocationVerificationKeys(
                client,
                headers,
                deadline,
                settings.CallTimeout,
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

    private static async Task<GetInvocationVerificationKeysResponse>
        FetchInvocationVerificationKeys(
            IdentityService.IdentityServiceClient client,
            Metadata headers,
            DateTime deadline,
            TimeSpan timeout,
            CancellationToken cancellation)
    {
        var firstDeadline = new DateTime(
            Math.Min(
                deadline.Ticks,
                DateTime.UtcNow.AddTicks(
                    Math.Max(1, timeout.Ticks / 4)).Ticks),
            DateTimeKind.Utc);
        try
        {
            return await FetchInvocationVerificationKeysOnce(
                client,
                headers,
                firstDeadline,
                cancellation);
        }
        catch (RpcException exception) when (
            !cancellation.IsCancellationRequested
            && exception.StatusCode is StatusCode.Unavailable
                or StatusCode.DeadlineExceeded)
        {
            return await FetchInvocationVerificationKeysOnce(
                client,
                headers,
                deadline,
                cancellation);
        }
    }

    private static async Task<GetInvocationVerificationKeysResponse>
        FetchInvocationVerificationKeysOnce(
            IdentityService.IdentityServiceClient client,
            Metadata headers,
            DateTime deadline,
            CancellationToken cancellation)
    {
        var callOptions = new CallOptions(
            headers,
            deadline,
            cancellationToken: cancellation)
            .WithWaitForReady();
        return await client.GetInvocationVerificationKeysAsync(
            new GetInvocationVerificationKeysRequest(),
            callOptions);
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
            if (key.Algorithm != VerificationKeyAlgorithm.Rs256
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
