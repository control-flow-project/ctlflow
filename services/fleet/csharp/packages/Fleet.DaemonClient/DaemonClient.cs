using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Storage;

namespace Fleet.DaemonClient;

public sealed class DaemonClient : IDisposable
{
    private readonly HttpClient http;
    private readonly Func<string> credential;
    public DaemonClient(string socket, Func<string>? credential = null)
    {
        var handler = new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, UseProxy = false, AutomaticDecompression = DecompressionMethods.None, ConnectTimeout = TimeSpan.FromSeconds(15),
            ConnectCallback = async (_, cancellation) =>
            {
                PrivateFiles.UnixSocket(socket); var connection = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                try { await connection.ConnectAsync(new UnixDomainSocketEndPoint(socket), cancellation); return new NetworkStream(connection, true); } catch { connection.Dispose(); throw; }
            } };
        http = new(handler) { Timeout = Timeout.InfiniteTimeSpan }; this.credential = credential ?? (() => Authentication.Read());
    }
    public async ValueTask<Result<JsonElement>> Call(string operation, IReadOnlyDictionary<string, string>? parameters, JsonElement? input, CancellationToken cancellation, IReadOnlyDictionary<string, string>? query = null)
    {
        string key;
        try { key = credential(); }
        catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException) { return Results.Fail<JsonElement>("unauthorized", "Cannot read the private fleetd authentication configuration; start fleetd to initialize it"); }
        var client = new OperationClient(http, "http://localhost", () => key, DaemonOperations.All, 120000, 16777216);
        try { return await client.Call(new(operation, parameters ?? new Dictionary<string, string>(), input, query), cancellation); }
        catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException or SocketException or OperationCanceledException) { return Results.Fail<JsonElement>("unavailable", "Cannot connect to the selected daemon; inspect its saved operation before retrying"); }
    }
    public void Dispose() => http.Dispose();
}
