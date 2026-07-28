using System.Text.Json;

namespace CtlFlow.Configuration.Configd.Db.Content;

public static partial class ConfigurationContents
{
    public static ValueTask<ConfigurationContentLease>
        CreateConfigurationContent(
            ReadOnlyMemory<byte> content,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (content.Length is < 1 or > 65_536)
        {
            throw content.Length > 65_536
                ? new ContentLimitExceededException()
                : new ArgumentException(
                    "Configuration content cannot be empty",
                    nameof(content));
        }

        var span = content.Span;
        if (span.Length >= 3
            && span[0] == 0xef
            && span[1] == 0xbb
            && span[2] == 0xbf)
        {
            throw new ArgumentException(
                "Configuration content cannot contain a UTF-8 BOM",
                nameof(content));
        }

        try
        {
            using var document = JsonDocument.Parse(
                content,
                new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = 32
                });
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new ArgumentException(
                    "Configuration content must be a JSON object",
                    nameof(content));
            }

            EnsureUniqueMembers(document.RootElement);
        }
        catch (JsonException exception)
        {
            throw new ArgumentException(
                "Configuration content is not admitted JSON",
                nameof(content),
                exception);
        }

        return ValueTask.FromResult(
            new ConfigurationContentLease(content.ToArray()));
    }

    private static void EnsureUniqueMembers(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
            {
                var names = new HashSet<string>(StringComparer.Ordinal);
                foreach (var property in element.EnumerateObject())
                {
                    if (!names.Add(property.Name))
                    {
                        throw new ArgumentException(
                            "Configuration content has duplicate members",
                            nameof(element));
                    }

                    EnsureUniqueMembers(property.Value);
                }

                break;
            }
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    EnsureUniqueMembers(item);
                }

                break;
        }
    }
}
