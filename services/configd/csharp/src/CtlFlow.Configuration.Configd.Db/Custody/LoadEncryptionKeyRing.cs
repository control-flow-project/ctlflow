using System.Text.Json;

namespace CtlFlow.Configuration.Configd.Db.Custody;

public static partial class SecretCustody
{
    private const int MaximumKeyRingBytes = 4_096;

    public static async Task<EncryptionKeyRing> LoadEncryptionKeyRing(
        string absolutePath,
        CancellationToken cancellation)
    {
        if (!Path.IsPathFullyQualified(absolutePath))
        {
            throw new ArgumentException(
                "Encryption key ring path must be absolute",
                nameof(absolutePath));
        }

        await using var stream = new FileStream(
            absolutePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: MaximumKeyRingBytes,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (stream.Length is < 1 or > MaximumKeyRingBytes)
        {
            throw new InvalidOperationException(
                "Encryption key ring is outside the admitted bound");
        }

        var content = new byte[checked((int)stream.Length)];
        await stream.ReadExactlyAsync(content, cancellation);
        try
        {
            return ParseKeyRing(content);
        }
        finally
        {
            Array.Clear(content);
        }
    }

    private static EncryptionKeyRing ParseKeyRing(ReadOnlyMemory<byte> content)
    {
        try
        {
            using var document = JsonDocument.Parse(content);
            var root = document.RootElement;
            EnsureObjectFields(
                root,
                new[] { "active_key_id", "keys" });
            var activeId = EncryptionKeyId.Parse(
                root.GetProperty("active_key_id").GetString()
                ?? throw new InvalidOperationException(
                    "Active encryption key ID is required"));
            var keysElement = root.GetProperty("keys");
            if (keysElement.ValueKind != JsonValueKind.Array
                || keysElement.GetArrayLength() is < 1 or > 8)
            {
                throw new InvalidOperationException(
                    "Encryption key ring must contain one through eight keys");
            }

            var keys = new Dictionary<EncryptionKeyId, EncryptionKey>();
            try
            {
                foreach (var item in keysElement.EnumerateArray())
                {
                    EnsureObjectFields(
                        item,
                        new[] { "key_id", "key_base64" });
                    var id = EncryptionKeyId.Parse(
                        item.GetProperty("key_id").GetString()
                        ?? throw new InvalidOperationException(
                            "Encryption key ID is required"));
                    var encoded = item.GetProperty("key_base64").GetString()
                        ?? throw new InvalidOperationException(
                            "Encryption key material is required");
                    var material = ParseKeyMaterial(encoded);
                    if (!keys.TryAdd(id, new EncryptionKey(id, material)))
                    {
                        Array.Clear(material);
                        throw new InvalidOperationException(
                            "Encryption key IDs must be unique");
                    }
                }

                if (!keys.ContainsKey(activeId))
                {
                    throw new InvalidOperationException(
                        "Active encryption key is absent");
                }

                return new EncryptionKeyRing(activeId, keys);
            }
            catch
            {
                foreach (var key in keys.Values)
                {
                    key.Dispose();
                }

                throw;
            }
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException(
                "Encryption key ring is not valid JSON",
                exception);
        }
    }

    private static byte[] ParseKeyMaterial(string encoded)
    {
        if (encoded.Length != 44)
        {
            throw new InvalidOperationException(
                "Encryption key material must be canonical base64");
        }

        byte[] material;
        try
        {
            material = Convert.FromBase64String(encoded);
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException(
                "Encryption key material must be canonical base64",
                exception);
        }

        if (material.Length != 32
            || !string.Equals(
                Convert.ToBase64String(material),
                encoded,
                StringComparison.Ordinal))
        {
            Array.Clear(material);
            throw new InvalidOperationException(
                "Encryption key material must be canonical 32-byte base64");
        }

        return material;
    }

    private static void EnsureObjectFields(
        JsonElement element,
        IReadOnlyList<string> expected)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                "Encryption key ring value must be an object");
        }

        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!expected.Contains(property.Name, StringComparer.Ordinal)
                || !found.Add(property.Name))
            {
                throw new InvalidOperationException(
                    "Encryption key ring fields are invalid");
            }
        }

        if (found.Count != expected.Count)
        {
            throw new InvalidOperationException(
                "Encryption key ring fields are incomplete");
        }
    }
}
