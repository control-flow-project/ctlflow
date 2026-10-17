using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Fleetd.Storage;

if (args.Length != 0) throw new ArgumentException("Storage acceptance takes no suite flags");
if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Storage acceptance requires the supported Linux filesystem adapter");
var assertions = 0;
void Check(bool condition, string label) { if (!condition) throw new InvalidOperationException(label); assertions++; }
void Reject(Action action, string label) { try { action(); } catch (IOException error) { Check(!error.Message.Contains("do-not-leak-secret", StringComparison.Ordinal), label); return; } throw new InvalidOperationException(label); }
Check(Authentication.ConfigurationDirectory("linux", "/home/operator", null) == "/home/operator/.config/ctlflow", "Linux default");
Check(Authentication.ConfigurationDirectory("linux", "/home/operator", "/private/config") == "/private/config/ctlflow", "XDG override");
Check(Authentication.ConfigurationDirectory("darwin", "/Users/operator", "/ignored") == "/Users/operator/Library/Application Support/ctlflow", "macOS ignores XDG");
Reject(() => Authentication.ConfigurationDirectory("linux", "/home/operator", "/private/config/"), "Trailing configuration separator rejected");
Reject(() => Authentication.ConfigurationDirectory("linux", "/home/operator/", null), "Trailing home separator rejected");
foreach (var (platform, home, xdg) in new (string, string, string?)[] { ("windows", "/home/operator", null), ("linux", "relative", null), ("linux", "/home/operator/../other", null), ("linux", "/home/operator", ""), ("linux", "/home/operator", "relative"), ("linux", "/home/operator", "/private/../other"), ("linux", "/home/operator", "/private/./other"), ("linux", "/home/operator", "/private//other") })
    Reject(() => Authentication.ConfigurationDirectory(platform, home, xdg), "Reject noncanonical OS configuration path");
using var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("Fleetd.AuthenticationCases") ?? throw new InvalidOperationException("Shared cases missing");
using var cases = JsonDocument.Parse(input);
foreach (var selected in cases.RootElement.GetProperty("valid").EnumerateArray()) Check(Authentication.Decode(Encoding.UTF8.GetBytes(selected.GetProperty("text").GetString()!)) == selected.GetProperty("key").GetString(), selected.GetProperty("label").GetString()!);
foreach (var selected in cases.RootElement.GetProperty("invalid").EnumerateArray()) Reject(() => Authentication.Decode(Encoding.UTF8.GetBytes(selected.GetString()!)), "Reject invalid shared case");
Reject(() => Authentication.Decode(new byte[] { 0xc3, 0x28 }), "Reject invalid UTF-8");
Reject(() => Authentication.Decode(new byte[4097]), "Reject oversized configuration");
var directory = Path.Combine(Path.GetTempPath(), "fleetd-auth-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
try
{
    var file = Path.Combine(directory, "ctlflow", "fleetd.json");
    Reject(() => Authentication.Read(file), "Client cannot initialize configuration"); Check(!Directory.Exists(Path.GetDirectoryName(file)), "Read has no filesystem effects");
    var key = await Authentication.Initialize(file); var modified = File.GetLastWriteTimeUtc(file);
    Check(key.Length == 64 && key.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f'), "Random 256-bit key format");
    Check((int)File.GetUnixFileMode(file) == 384 && (int)File.GetUnixFileMode(Path.GetDirectoryName(file)!) == 448, "Private file and directory");
    Check(await Authentication.Initialize(file) == key && Authentication.Read(file) == key && File.GetLastWriteTimeUtc(file) == modified, "Initialization and reads retain existing key without writes");
    Check(await Authentication.Initialize(Path.Combine(directory, "other", "fleetd.json")) != key, "Different initializations use different keys");
    var concurrent = Path.Combine(directory, "concurrent", "fleetd.json");
    var keys = await Task.WhenAll(Enumerable.Range(0, 8).Select(_index => Authentication.Initialize(concurrent).AsTask())); Check(keys.All(selected => selected == keys[0]), "Concurrent starts retain one key");
    Check(Authentication.Matches("Bearer " + key, key), "Exact bearer accepted");
    foreach (var header in new string?[] { null, "", key, "bearer " + key, "Bearer guessed", "Bearer " + key + ", Bearer " + key }) Check(!Authentication.Matches(header, key), "Invalid bearer denied");
    File.WriteAllText(file, "{\"schemaVersion\":1}"); Reject(() => Authentication.Read(file), "Keyless configuration cannot authenticate");
    key = await Authentication.Initialize(file); Check(Authentication.Read(file) == key, "Valid missing key is inserted");
    foreach (var selected in cases.RootElement.GetProperty("invalid").EnumerateArray())
    {
        var content = selected.GetString()!; File.WriteAllText(file, content);
        try { await Authentication.Initialize(file); throw new InvalidOperationException("Invalid configuration replaced"); } catch (IOException) { Check(File.ReadAllBytes(file).AsSpan().SequenceEqual(Encoding.UTF8.GetBytes(content)), "Invalid file bytes are preserved"); }
    }
    File.WriteAllText(file, "{\"schemaVersion\":1,\"authenticationKey\":\"" + key + "\"}");
    File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
    Reject(() => Authentication.Read(file), "Nonprivate file rejected"); File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    File.SetUnixFileMode(Path.GetDirectoryName(file)!, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupExecute);
    Reject(() => Authentication.Read(file), "Nonprivate parent rejected"); File.SetUnixFileMode(Path.GetDirectoryName(file)!, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    var contentBytes = File.ReadAllBytes(file); var linked = Path.Combine(directory, "linked.json"); File.WriteAllBytes(linked, contentBytes); File.Delete(file); File.CreateSymbolicLink(file, linked);
    Reject(() => Authentication.Read(file), "Symlink rejected"); File.Delete(file); File.CreateSymbolicLink(file, Path.Combine(directory, "absent")); Reject(() => Authentication.Read(file), "Dangling symlink rejected");
}
finally { Directory.Delete(directory, true); }
Console.WriteLine("{\"status\":\"passed\",\"scope\":\"fleetd authentication storage\",\"assertions\":" + assertions + ",\"dynamicCode\":" + (RuntimeFeature.IsDynamicCodeSupported ? "true" : "false") + "}");
