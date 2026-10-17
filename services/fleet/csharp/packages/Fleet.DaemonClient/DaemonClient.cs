using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;

namespace Fleet.DaemonClient;

public sealed class DaemonClient : IDisposable
{
    private readonly HttpClient http;
    private readonly OperationClient client;
    public DaemonClient(string socket)
    {
        var handler = new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, UseProxy = false, AutomaticDecompression = DecompressionMethods.None, ConnectTimeout = TimeSpan.FromSeconds(15),
            ConnectCallback = async (_, cancellation) =>
            {
                PrivateFiles.UnixSocket(socket); var connection = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                try { await connection.ConnectAsync(new UnixDomainSocketEndPoint(socket), cancellation); return new NetworkStream(connection, true); } catch { connection.Dispose(); throw; }
            } };
        http = new(handler) { Timeout = Timeout.InfiniteTimeSpan }; client = new(http, "http://localhost", () => null, DaemonOperations.All, 120000, 16777216);
    }
    public async ValueTask<Result<JsonElement>> Call(string operation, IReadOnlyDictionary<string, string>? parameters, JsonElement? input, CancellationToken cancellation, IReadOnlyDictionary<string, string>? query = null)
    {
        try { return await client.Call(new(operation, parameters ?? new Dictionary<string, string>(), input, query), cancellation); }
        catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException or SocketException or OperationCanceledException) { return Results.Fail<JsonElement>("unavailable", "Cannot connect to the selected fleet daemon; inspect its saved operation before retrying"); }
    }
    public void Dispose() => http.Dispose();
}
