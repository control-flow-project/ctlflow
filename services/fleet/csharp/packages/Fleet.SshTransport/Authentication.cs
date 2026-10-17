using System.Text;
using System.Text.Json;
using Crossfire.AdapterProcess;
using Crossfire.Kernel;

namespace Fleet.SshTransport;

public static class RemoteAuthentication
{
    public static async ValueTask<Result<string>> Read(string host, CancellationToken cancellation)
    {
        if (!SshTunnel.ValidHost(host)) return Results.Fail<string>("invalid", "Use a configured SSH hostname");
        using var asset = typeof(RemoteAuthentication).Assembly.GetManifestResourceStream("Fleet.RemoteAuthentication") ?? throw new InvalidOperationException("Remote authentication asset is missing");
        using var parsed = JsonDocument.Parse(asset);
        var script = parsed.RootElement.GetProperty("script").GetString()!;
        var command = new NativeCommand("ssh", ["-T", "-o", "StrictHostKeyChecking=yes", host, "sh -c " + SshTunnel.Quote(script)], Path.GetFullPath(Environment.CurrentDirectory), new Dictionary<string, string?>());
        var result = await NativeProcess.Capture(command, 4096, 15000, cancellation);
        if (!result.IsSuccess || result.Value.ExitCode != 0) return Results.Fail<string>("unauthorized", "Cannot read remote fleetd authentication through trusted SSH");
        try
        {
            var key = Fleetd.Storage.Authentication.Decode(Encoding.UTF8.GetBytes(result.Value.Output));
            return key is null ? Results.Fail<string>("unauthorized", "Remote fleetd authentication key is missing; start its controller first") : Result<string>.Success(key);
        }
        catch (IOException) { return Results.Fail<string>("unauthorized", "Invalid remote fleetd authentication configuration"); }
    }
}
