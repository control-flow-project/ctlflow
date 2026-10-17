using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Fleetd.Storage;

public static class Authentication
{
    public static string ConfigurationRoot(string platform, string home, string? xdg)
    {
        if (!Path.IsPathFullyQualified(home) || Path.TrimEndingDirectorySeparator(Path.GetFullPath(home)) != home) throw new IOException("HOME must be an absolute normalized path");
        var root = platform switch { "darwin" => Path.Combine(home, "Library", "Application Support"), "linux" => xdg ?? Path.Combine(home, ".config"), _ => throw new IOException("Unsupported configuration platform") };
        if (!Path.IsPathFullyQualified(root) || Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)) != root) throw new IOException("Configuration directory must be absolute and normalized");
        return root;
    }
    public static string ConfigurationDirectory(string platform, string home, string? xdg) => Path.Combine(ConfigurationRoot(platform, home, xdg), "ctlflow");
    public static string Root => ConfigurationRoot(OperatingSystem.IsMacOS() ? "darwin" : OperatingSystem.IsLinux() ? "linux" : "unsupported", Environment.GetEnvironmentVariable("HOME") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), Environment.GetEnvironmentVariable("XDG_CONFIG_HOME"));
    public static string FilePath => Path.Combine(Root, "ctlflow", "fleetd.json");
    private static string? ReadSettings(string file)
    {
        if (!Path.IsPathFullyQualified(file) || Path.GetFullPath(file) != file) throw new IOException("Fleetd configuration path must be absolute and normalized");
        if (!PrivateFiles.Exists(file)) return null;
        try
        {
            PrivateFiles.ExistingDirectory(Path.GetDirectoryName(file)!, true);
            return Decode(PrivateFiles.Read(file, 4096));
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException or ArgumentException)
        { throw new IOException("Invalid or unsafe fleetd configuration; expected schemaVersion 1 and a private 256-bit authenticationKey"); }
    }
    public static string? Decode(ReadOnlyMemory<byte> bytes)
    {
        try
        {
            if (bytes.Length > 4096) throw new IOException();
            var value = WireJson.Parse(bytes);
            if (!Validation.Fields(value, ["schemaVersion"], ["authenticationKey"]).IsSuccess || !Validation.Integer(value.GetProperty("schemaVersion"), 1, 1).IsSuccess) throw new IOException();
            var fields = value.EnumerateObject().Select(field => field.Name).ToArray();
            if (fields.Distinct(StringComparer.Ordinal).Count() != fields.Length) throw new IOException();
            if (!value.TryGetProperty("authenticationKey", out var selected)) return null;
            var key = selected.ValueKind == JsonValueKind.String ? selected.GetString() : null;
            if (key is null || key.Length != 64 || key.Any(character => character is not (>= 'a' and <= 'f' or >= '0' and <= '9'))) throw new IOException();
            return key;
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException or ArgumentException)
        { throw new IOException("Invalid fleetd configuration; expected unique fields, schemaVersion 1 and a 256-bit authenticationKey"); }
    }
    public static string Read(string? file = null) => ReadSettings(file ?? FilePath) ?? throw new IOException("Fleetd authentication key is missing; start fleetd to initialize its configuration");
    public static async ValueTask<string> Initialize(string? file = null, CancellationToken cancellation = default)
    {
        file ??= FilePath;
        if (ReadSettings(file) is { } existing) return existing;
        var parent = Path.GetDirectoryName(file)!;
        if (PrivateFiles.Exists(parent)) PrivateFiles.ExistingDirectory(parent, true); else PrivateFiles.Directory(parent);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        StateLock? ownership = null;
        while (ownership is null)
        {
            scope.Token.ThrowIfCancellationRequested();
            try { ownership = new(file); }
            catch (IOException error) when (error.Message == "Another process already owns this private state") { await Task.Delay(50, scope.Token); }
        }
        using (ownership)
        {
            if (ReadSettings(file) is { } retained) return retained;
            var key = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            var value = WireJson.Object(writer => { writer.WriteNumber("schemaVersion", 1); writer.WriteString("authenticationKey", key); });
            PrivateFiles.Write(file, Encoding.UTF8.GetBytes(WireJson.Pretty(value)), 4096);
            return Read(file);
        }
    }
    public static bool Matches(string? header, string key)
        => CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(header ?? ""), Encoding.ASCII.GetBytes("Bearer " + key));
}
