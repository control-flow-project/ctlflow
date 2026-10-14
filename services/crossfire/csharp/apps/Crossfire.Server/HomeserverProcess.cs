using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server;

public sealed partial class HomeserverProcess : IAsyncDisposable
{
    private readonly Process process;
    private readonly Task output;
    private readonly Task errors;
    private readonly string temporary;
    private Task? closing;
    public Task Ended { get; }
    private HomeserverProcess(Process process, string temporary, PlatformDiagnostics diagnostics)
    {
        this.process = process; this.temporary = temporary;
        output = Pump(process.StandardOutput, diagnostics); errors = Pump(process.StandardError, diagnostics); Ended = process.WaitForExitAsync();
    }
    [LibraryImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static partial int Signal(int pid, int signal);

    public static HomeserverProcess Start(ServerConfiguration configuration, string directory, string binary, PlatformDiagnostics diagnostics)
    {
        if (configuration.MatrixOrigin != "http://127.0.0.1:6167") throw new ArgumentException("Bundled Matrix origin must use its private loopback port");
        var database = PrivateFiles.Directory(Path.Combine(directory, "matrix"));
        var temporary = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-homeserver-" + Identity.Identifier()));
        var path = Path.Combine(temporary, "conduit.toml");
        var settings = new (string Name, string Value)[]
        {
            ("server_name", Text(configuration.ServerName)), ("database_path", Text(database)), ("database_backend", "\"rocksdb\""), ("address", "\"127.0.0.1\""), ("port", "6167"),
            ("max_request_size", "20971520"), ("allow_registration", "true"), ("registration_token", Text(configuration.RegistrationSecret)), ("jwt_secret", Text(configuration.JwtSecret)),
            ("allow_room_creation", "true"), ("allow_federation", "false"), ("allow_encryption", "false"), ("allow_check_for_updates", "false"), ("trusted_servers", "[]"), ("log", "\"warn\"")
        };
        PrivateFiles.Write(path, Encoding.UTF8.GetBytes("[global]\n" + string.Join('\n', settings.Select(setting => setting.Name + " = " + setting.Value)) + "\n"), 16384);
        var start = new ProcessStartInfo(binary) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        start.Environment["CONDUIT_CONFIG"] = path;
        try { return new(Process.Start(start) ?? throw new IOException("Homeserver process did not start"), temporary, diagnostics); }
        catch { Directory.Delete(temporary, recursive: true); throw; }
    }
    private static string Text(string value) => ProtocolJson.Quote(value);
    private static async Task Pump(StreamReader reader, PlatformDiagnostics diagnostics)
    {
        var characters = new char[16384];
        for (;;)
        {
            var count = await reader.ReadAsync(characters.AsMemory()); if (count == 0) break;
            diagnostics.Write("Matrix: " + new string(characters, 0, count));
        }
    }
    public async Task Ready(ServerConfiguration configuration, CancellationToken cancellation, TimeProvider? time = null)
    {
        var clock = time ?? TimeProvider.System; var end = clock.GetTimestamp() + clock.TimestampFrequency * 60;
        using var client = NativeHttp.Client();
        while (clock.GetTimestamp() < end)
        {
            cancellation.ThrowIfCancellationRequested();
            if (Ended.IsCompleted) throw new IOException("Homeserver exited before readiness");
            var result = await NativeHttp.Json(client, new(configuration.MatrixOrigin, TimeoutMs: 1000), "GET", "/_matrix/client/versions", maximumBytes: 65536, cancellation: cancellation);
            if (result.IsSuccess) { using var response = result.Value; if (response.Status == 200) return; }
            await Task.Delay(TimeSpan.FromMilliseconds(100), clock, cancellation);
        }
        throw new IOException("Homeserver readiness timed out");
    }
    public ValueTask DisposeAsync() => new(closing ??= Close());
    private async Task Close()
    {
        try
        {
            if (!process.HasExited && Signal(process.Id, 15) != 0 && Marshal.GetLastPInvokeError() != 3) throw new IOException("Homeserver shutdown signal failed");
            try { await Ended.WaitAsync(TimeSpan.FromSeconds(5)); }
            catch (TimeoutException) { process.Kill(entireProcessTree: true); await Ended.WaitAsync(TimeSpan.FromSeconds(5)); }
            await Task.WhenAll(output, errors);
        }
        finally { process.Dispose(); Directory.Delete(temporary, recursive: true); }
    }
}
