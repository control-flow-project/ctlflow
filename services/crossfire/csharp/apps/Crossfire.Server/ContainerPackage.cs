using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;

namespace Crossfire.Server;

public sealed record ContainerPackageValue(string Version, string SourceDigest, string Backend, string ArchiveSha256, string RuntimeImage, string MigrationImage);

public static partial class ContainerPackage
{
    [GeneratedRegex(@"\A[a-f0-9]{64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Digest();
    [GeneratedRegex(@"\Asha256:[a-f0-9]{64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Image();
    [GeneratedRegex(@"\A[a-z][a-z0-9-]{0,63}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Backend();
    [GeneratedRegex(@"\A[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex Version();

    public static ContainerPackageValue Parse(JsonElement input)
    {
        var fields = Validation.Fields(input, ["schemaVersion", "version", "sourceDigest", "backend", "platform", "archiveSha256", "runtimeImage", "migrationImage"]);
        if (!fields.IsSuccess || input.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number || input.GetProperty("schemaVersion").GetDouble() != 1
            || input.GetProperty("platform").ValueKind != JsonValueKind.String || input.GetProperty("platform").GetString() != "linux/amd64") throw new ArgumentException("Invalid container package manifest");
        string Text(string key) => input.GetProperty(key).ValueKind == JsonValueKind.String ? input.GetProperty(key).GetString()! : throw new ArgumentException("Invalid container package manifest");
        var value = new ContainerPackageValue(Text("version"), Text("sourceDigest"), Text("backend"), Text("archiveSha256"), Text("runtimeImage"), Text("migrationImage"));
        if (!Version().IsMatch(value.Version) || value.Backend == "migrations" || !Backend().IsMatch(value.Backend) || !Digest().IsMatch(value.SourceDigest) || !Digest().IsMatch(value.ArchiveSha256)
            || !Image().IsMatch(value.RuntimeImage) || !Image().IsMatch(value.MigrationImage) || value.RuntimeImage == value.MigrationImage) throw new ArgumentException("Invalid container package manifest");
        return value;
    }

    public static IReadOnlyDictionary<string, string> Labels(ContainerPackageValue value, string backend) => new Dictionary<string, string>
    { ["org.crossfire.package"] = "1", ["org.opencontainers.image.version"] = value.Version, ["org.crossfire.source"] = value.SourceDigest, ["org.crossfire.backend"] = backend };

    public static async Task<ContainerPackageValue> Prepare(string directory, string workspace, CancellationToken cancellation)
    {
        using var manifest = AssetFiles.Open(directory, "release.json"); using var archive = AssetFiles.Open(directory, "images.tar");
        if (manifest.Length is < 1 or > 8192 || archive.Length is < 1 or > 17179869184) throw new IOException("Container package files must be bounded regular files");
        using var document = JsonDocument.Parse(manifest); var value = Parse(document.RootElement);
        var digest = Convert.ToHexStringLower(await SHA256.HashDataAsync(archive, cancellation));
        if (digest != value.ArchiveSha256) throw new IOException("Container package archive SHA-256 does not match");
        var selections = new[] { (Image: value.RuntimeImage, Backend: value.Backend), (Image: value.MigrationImage, Backend: "migrations") };
        var present = true;
        foreach (var selected in selections) if (!await ContainerCommands.Image(selected.Image, workspace, cancellation)) present = false;
        if (!present) await ContainerCommands.Run(["load", "--input", Path.Combine(directory, "images.tar")], workspace, cancellation);
        foreach (var selected in selections)
        {
            var inspected = await ContainerCommands.Capture(["image", "inspect", selected.Image], workspace, cancellation);
            if (inspected.ExitCode != 0) throw new IOException("Container package is missing its exact image");
            using var response = JsonDocument.Parse(inspected.Output); var entries = response.RootElement;
            if (entries.ValueKind != JsonValueKind.Array || entries.GetArrayLength() != 1) throw new IOException("Container package image inspection is ambiguous");
            var image = entries[0];
            if (image.GetProperty("Id").GetString() != selected.Image || image.GetProperty("Os").GetString() != "linux" || image.GetProperty("Architecture").GetString() != "amd64"
                || Labels(value, selected.Backend).Any(pair => !image.GetProperty("Config").GetProperty("Labels").TryGetProperty(pair.Key, out var label) || label.GetString() != pair.Value))
                throw new IOException("Container package image identity, platform or release labels do not match");
        }
        return value;
    }
}
