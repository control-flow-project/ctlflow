using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;

namespace Crossfire.Server;

public sealed record PackageImageValue(string Reference, string ConfigDigest, string DescriptorDigest);
public sealed record ContainerPackageValue(string Version, string SourceDigest, string Backend, string ArchiveSha256, PackageImageValue Runtime, PackageImageValue Migration);
public sealed record PreparedContainerPackageValue(ContainerPackageValue Package, string RuntimeImage, string MigrationImage);

public static partial class ContainerPackage
{
    [GeneratedRegex(@"\A[a-f0-9]{64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Digest();
    [GeneratedRegex(@"\Asha256:[a-f0-9]{64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Image();
    [GeneratedRegex(@"\Acrossfire-package:[a-f0-9]{64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Reference();
    [GeneratedRegex(@"\A[a-z][a-z0-9-]{0,63}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Backend();
    [GeneratedRegex(@"\A[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex Version();

    public static ContainerPackageValue Parse(JsonElement input)
    {
        var fields = Validation.Fields(input, ["schemaVersion", "version", "sourceDigest", "backend", "platform", "archiveSha256", "runtime", "migration"]);
        if (!fields.IsSuccess || input.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number || input.GetProperty("schemaVersion").GetDouble() != 2
            || input.GetProperty("platform").ValueKind != JsonValueKind.String || input.GetProperty("platform").GetString() != "linux/amd64") throw new ArgumentException("Invalid container package manifest");
        string Text(string key) => input.GetProperty(key).ValueKind == JsonValueKind.String ? input.GetProperty(key).GetString()! : throw new ArgumentException("Invalid container package manifest");
        var value = new ContainerPackageValue(Text("version"), Text("sourceDigest"), Text("backend"), Text("archiveSha256"), ParseImage(input.GetProperty("runtime")), ParseImage(input.GetProperty("migration")));
        if (!Version().IsMatch(value.Version) || value.Backend == "migrations" || !Backend().IsMatch(value.Backend) || !Digest().IsMatch(value.SourceDigest) || !Digest().IsMatch(value.ArchiveSha256)
            || value.Runtime.Reference == value.Migration.Reference || value.Runtime.ConfigDigest == value.Migration.ConfigDigest
            || value.Runtime.DescriptorDigest == value.Migration.DescriptorDigest) throw new ArgumentException("Invalid container package manifest");
        return value;
    }

    private static PackageImageValue ParseImage(JsonElement input)
    {
        if (!Validation.Fields(input, ["reference", "configDigest", "descriptorDigest"]).IsSuccess) throw new ArgumentException("Invalid container package image");
        string Text(string key) => input.GetProperty(key).ValueKind == JsonValueKind.String ? input.GetProperty(key).GetString()! : throw new ArgumentException("Invalid container package image");
        var value = new PackageImageValue(Text("reference"), Text("configDigest"), Text("descriptorDigest"));
        if (!Reference().IsMatch(value.Reference) || !Image().IsMatch(value.ConfigDigest) || !Image().IsMatch(value.DescriptorDigest)) throw new ArgumentException("Invalid container package image");
        return value;
    }

    public static string NativeImageIdentity(PackageImageValue expected, JsonElement input)
    {
        var identity = expected.ConfigDigest;
        if (input.TryGetProperty("Descriptor", out var descriptor) && descriptor.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
        {
            if (descriptor.ValueKind != JsonValueKind.Object || !descriptor.TryGetProperty("digest", out var digest) || digest.ValueKind != JsonValueKind.String || digest.GetString() != expected.DescriptorDigest
                || !descriptor.TryGetProperty("mediaType", out var media) || media.ValueKind != JsonValueKind.String || media.GetString() is not ("application/vnd.oci.image.manifest.v1+json" or "application/vnd.oci.image.index.v1+json"
                    or "application/vnd.docker.distribution.manifest.v2+json" or "application/vnd.docker.distribution.manifest.list.v2+json")) throw new IOException("Container image descriptor does not match");
            identity = expected.DescriptorDigest;
        }
        if (!input.TryGetProperty("Id", out var actual) || actual.ValueKind != JsonValueKind.String || actual.GetString() != identity) throw new IOException("Container image identity does not match");
        return identity;
    }

    public static IReadOnlyDictionary<string, string> Labels(ContainerPackageValue value, string backend) => new Dictionary<string, string>
    { ["org.crossfire.package"] = "1", ["org.opencontainers.image.version"] = value.Version, ["org.crossfire.source"] = value.SourceDigest, ["org.crossfire.backend"] = backend };

    public static async Task<PreparedContainerPackageValue> Prepare(string directory, string workspace, CancellationToken cancellation)
    {
        using var manifest = AssetFiles.Open(directory, "release.json"); using var archive = AssetFiles.Open(directory, "images.tar");
        if (manifest.Length is < 1 or > 8192 || archive.Length is < 1 or > 17179869184) throw new IOException("Container package files must be bounded regular files");
        using var document = JsonDocument.Parse(manifest); var value = Parse(document.RootElement);
        var digest = Convert.ToHexStringLower(await SHA256.HashDataAsync(archive, cancellation));
        if (digest != value.ArchiveSha256) throw new IOException("Container package archive SHA-256 does not match");
        var selections = new[] { (Image: value.Runtime, Backend: value.Backend), (Image: value.Migration, Backend: "migrations") };
        var present = true;
        foreach (var selected in selections) if (!await ContainerCommands.Image(selected.Image.Reference, workspace, cancellation)) present = false;
        if (!present) await ContainerCommands.Run(["load", "--input", Path.Combine(directory, "images.tar")], workspace, cancellation);
        var identities = new List<string>();
        foreach (var selected in selections)
        {
            var inspected = await ContainerCommands.Capture(["image", "inspect", selected.Image.Reference], workspace, cancellation);
            if (inspected.ExitCode != 0) throw new IOException("Container package is missing its exact image");
            using var response = JsonDocument.Parse(inspected.Output); var entries = response.RootElement;
            if (entries.ValueKind != JsonValueKind.Array || entries.GetArrayLength() != 1) throw new IOException("Container package image inspection is ambiguous");
            var image = entries[0];
            identities.Add(NativeImageIdentity(selected.Image, image));
            if (image.GetProperty("Os").GetString() != "linux" || image.GetProperty("Architecture").GetString() != "amd64"
                || Labels(value, selected.Backend).Any(pair => !image.GetProperty("Config").GetProperty("Labels").TryGetProperty(pair.Key, out var label) || label.GetString() != pair.Value))
                throw new IOException("Container package image identity, platform or release labels do not match");
        }
        return new(value, identities[0], identities[1]);
    }
}
