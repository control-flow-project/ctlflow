using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterFilesystem;

public sealed record Release(JsonElement Manifest, string Version, string Identity, IReadOnlyDictionary<string, byte[]> Files);

public static class Releases
{
    public static readonly IReadOnlyList<string> ArtifactNames = ["README.md", "SKILL.md", "crossfire-client.mjs", "matrix-spec-LICENSE.txt"];

    public static Release Load(string directory)
    {
        using var document = WireJson.Document(PrivateFiles.ReadPublished(Path.Combine(directory, "manifest.json"), 16384));
        var manifest = document.RootElement;
        Require(Validation.Fields(manifest, ["release", "version", "artifacts"]).IsSuccess);
        var versionValue = Validation.Text(manifest.GetProperty("version"), 40); var identityValue = Validation.Text(manifest.GetProperty("release"), 65);
        Require(versionValue.IsSuccess && identityValue.IsSuccess);
        var version = versionValue.Value; var identity = identityValue.Value;
        Require(ReleaseValues.Version(version) && ReleaseValues.Identity(identity) && identity.StartsWith(version + "-", StringComparison.Ordinal));
        var artifacts = manifest.GetProperty("artifacts");
        Require(Validation.Fields(artifacts, ArtifactNames).IsSuccess);
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var name in ArtifactNames)
        {
            var file = artifacts.GetProperty(name);
            Require(Validation.Fields(file, ["bytes", "sha256"]).IsSuccess);
            var length = Validation.Integer(file.GetProperty("bytes"), 1, 8388608);
            var digest = Validation.Text(file.GetProperty("sha256"), 64, 64);
            Require(length.IsSuccess && digest.IsSuccess);
            var bytes = PrivateFiles.ReadPublished(Path.Combine(directory, name), 8388608);
            var actual = Convert.ToHexStringLower(SHA256.HashData(bytes));
            Require(bytes.LongLength == length.Value && digest.Value == actual);
            hash.AppendData(Encoding.UTF8.GetBytes(name + "\0" + actual + "\0"));
            files.Add(name, bytes);
        }
        Require(identity == version + "-" + Convert.ToHexStringLower(hash.GetHashAndReset())[..24]);
        return new(manifest.Clone(), version, identity, files);
    }

    private static void Require(bool condition)
    {
        if (!condition) throw new IOException("Invalid or changed release artifact manifest");
    }
}
