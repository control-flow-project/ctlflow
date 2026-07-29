using System.Text.Json;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    private const long MaximumDocumentBytes = 1024 * 1024;

    internal static async Task<JsonDocument> ReadStrictJsonDocument(
        string path,
        string label,
        CancellationToken cancellation)
    {
        try
        {
            var file = new FileInfo(path);
            if (!file.Exists || file.Length is <= 0 or > MaximumDocumentBytes)
            {
                throw new InvalidDataException(
                    $"{label} has an invalid size");
            }

            await using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                16 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            return await JsonDocument.ParseAsync(
                stream,
                new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = 16
                },
                cancellation);
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException
                or JsonException
                or InvalidDataException)
        {
            throw new InvalidOperationException(
                $"{label} is invalid",
                exception);
        }
    }
}
