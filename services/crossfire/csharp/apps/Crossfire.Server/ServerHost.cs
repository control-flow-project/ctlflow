using System.Runtime.InteropServices;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Kernel;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public sealed record ServerInput(string Directory, string Release, string Web, string Element, string Listen, string ContentListen, string? HomeserverBinary);

public static class ServerHost
{
    public static ServerInput Arguments(string[] arguments)
    {
        if (arguments.Length == 1 && arguments[0] == "container")
        {
            var releases = Directory.GetDirectories("/app/onboarding");
            if (releases.Length != 1) throw new IOException("Image must contain exactly one onboarding release");
            return new("/runtime", releases[0], "/app/web", "/app/element", "http://0.0.0.0:8080", "http://0.0.0.0:8082", "/usr/local/bin/conduit");
        }
        if (arguments.Length is < 5 or > 7 || arguments[0] != "serve") throw new ArgumentException("Use serve <private-state-directory> <release-directory> <shared-web-directory> <element-directory> [port] [content-port], or container");
        var port = Port(arguments.Length >= 6 ? arguments[5] : "8080"); var content = Port(arguments.Length == 7 ? arguments[6] : "8082");
        if (port == content) throw new ArgumentException("Content port must be separate from the application port");
        return new(Path.GetFullPath(arguments[1]), Path.GetFullPath(arguments[2]), Path.GetFullPath(arguments[3]), Path.GetFullPath(arguments[4]),
            "http://127.0.0.1:" + port, "http://127.0.0.1:" + content, null);
    }
    private static int Port(string value) => int.TryParse(value, out var port) && port is >= 1024 and <= 65535 ? port : throw new ArgumentException("Port must be within 1024..65535");

    public static async Task Run(ServerInput input, CancellationToken cancellation = default)
    {
        using var configuration = JsonDocument.Parse(PrivateFiles.Read(Path.Combine(input.Directory, "config.json"), 65536));
        var parsed = Configurations.Parse(configuration.RootElement); if (!parsed.IsSuccess) throw new ArgumentException(parsed.Error.Message);
        var config = parsed.Value; var backend = MatrixSettings.Read(config.Messaging, config.Instance, config.Administrator); if (!backend.IsSuccess) throw new ArgumentException(backend.Error.Message);
        if (new Uri(config.ContentOrigin).Host == new Uri(backend.Value.Origin).Host) throw new ArgumentException("Publications require a separate backend hostname");
        var release = Releases.Load(input.Release); var database = Path.Combine(input.Directory, "management.sqlite");
        using var storage = new ManagementStorage(database);
        using (var validation = storage.Open()) { var schema = Schema.Validate(validation); if (!schema.IsSuccess) throw new IOException(schema.Error.Message); }
        using var bootstrap = JsonDocument.Parse(PrivateFiles.Read(Path.Combine(input.Directory, "bootstrap.json"), 16384));
        var secrets = Bootstrap.Parse(bootstrap.RootElement); if (!secrets.IsSuccess) throw new ArgumentException(secrets.Error.Message);
        using var diagnostics = new DiagnosticStore(database + ".logs", config.LoggingRetentionDays, Identity.Now);
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, signal => { signal.Cancel = true; stop.Cancel(); });
        using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, signal => { signal.Cancel = true; stop.Cancel(); });
        using var hangup = PosixSignalRegistration.Create(PosixSignal.SIGHUP, signal => { signal.Cancel = true; stop.Cancel(); });
        await using var homeserver = input.HomeserverBinary is null ? null : HomeserverProcess.Start(backend.Value, input.Directory, input.HomeserverBinary, diagnostics);
        try
        {
            if (homeserver is not null) await homeserver.Ready(backend.Value, stop.Token);
            using var matrix = new AccountAuthority(backend.Value);
            var initialized = await Bootstrap.Apply(backend.Value, config.Administrator, secrets.Value, matrix, stop.Token); if (!initialized.IsSuccess) throw new IOException(initialized.Error.Message);
            using var reports = new PublicationStore(database + ".publications", config.PublicationBudget.Uploads, path => new StateLock(path));
            var state = new ApiState(config, storage, release, matrix.Ports(), matrix.RoomOperation, reports, diagnostics, Identity.Now(), Identity.Now);
            await using var worker = new ApiWorker(state); using var proxy = new MatrixProxy(); var webServices = MessagingComposition.Web(state, backend.Value); var presentation = ElementPresentation.Read(input.Element, config.PublicOrigin);
            MessagingHttpFactory webHandler = (admission, changed) => { var handler = NativeWeb.Create(webServices, presentation, admission, changed); return (http, path, request) => handler(http, path, request); };
            MessagingPublicRoutes publicHandler = (http, path, raw, api, serve) => NativeWeb.Public(http, path, raw, config.PublicOrigin, backend.Value.Origin, input.Element, proxy, api, serve);
            await using var content = ContentApplication.Build(state, input.ContentListen);
            await using var application = PublicApplication.Build(state, input.Listen, input.Web, webHandler, publicHandler, worker.Wake);
            await content.StartAsync(stop.Token); await application.StartAsync(stop.Token); worker.Start();
            diagnostics.Write("Crossfire ready: " + config.PublicOrigin + "/ | Management: " + config.PublicOrigin + "/manage/");
            var shutdown = application.WaitForShutdownAsync(stop.Token);
            if (homeserver is not null && await Task.WhenAny(shutdown, homeserver.Ended) == homeserver.Ended && !stop.IsCancellationRequested)
            { diagnostics.Write("Homeserver stopped unexpectedly"); stop.Cancel(); await shutdown; throw new IOException("Homeserver stopped unexpectedly"); }
            await shutdown; await content.StopAsync();
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception error) { diagnostics.Write("Crossfire process failed: " + error.GetType().Name + ": " + error.Message); throw; }
    }
}
