using System.Buffers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Crossfire.AdapterFilesystem;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Crossfire.Runtime.Tests;

public sealed class ProtocolFixture : IAsyncDisposable
{
    private readonly WebApplication server;
    private readonly Channel<JsonElement> input = Channel.CreateUnbounded<JsonElement>(new() { SingleWriter = true, SingleReader = true });
    private readonly TaskCompletionSource<WebSocket> connected = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly SemaphoreSlim writing = new(1);
    private readonly CancellationTokenSource stop = new();
    private readonly string? directory;
    public string Endpoint { get; private set; } = "";
    public const string Token = "native-private-token";
    private ProtocolFixture(WebApplication server, string? directory) { this.server = server; this.directory = directory; }

    public static async Task<ProtocolFixture> Open(bool unix = false)
    {
        var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders();
        var directory = unix ? PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-rpc-" + Guid.NewGuid().ToString("N"))) : null;
        var socket = directory is null ? null : Path.Combine(directory, "native.sock");
        if (socket is null) builder.WebHost.UseUrls("http://127.0.0.1:0");
        else builder.WebHost.ConfigureKestrel(options => options.ListenUnixSocket(socket));
        var application = builder.Build(); var fixture = new ProtocolFixture(application, directory); application.UseWebSockets();
        application.Run(fixture.Accept);
        try
        {
            await application.StartAsync();
            if (socket is null) fixture.Endpoint = application.Urls.Single().Replace("http:", "ws:", StringComparison.Ordinal);
            else { File.SetUnixFileMode(socket, UnixFileMode.UserRead | UnixFileMode.UserWrite); fixture.Endpoint = "unix://" + socket; }
            return fixture;
        }
        catch { await fixture.DisposeAsync(); throw; }
    }
    private async Task Accept(HttpContext context)
    {
        if (directory is null && context.Request.Headers.Authorization != "Bearer " + Token) { context.Response.StatusCode = 403; return; }
        using var socket = await context.WebSockets.AcceptWebSocketAsync(); connected.TrySetResult(socket); var buffer = new byte[65536];
        try
        {
            while (!stop.IsCancellationRequested)
            {
                var message = new ArrayBufferWriter<byte>(); ValueWebSocketReceiveResult frame;
                do
                {
                    frame = await socket.ReceiveAsync(buffer.AsMemory(), stop.Token);
                    if (frame.MessageType == WebSocketMessageType.Close) return;
                    if (message.WrittenCount + frame.Count > 8388608) throw new InvalidDataException("Fixture native input exceeded its frame budget");
                    message.Write(buffer.AsSpan(0, frame.Count));
                } while (!frame.EndOfMessage);
                using var parsed = JsonDocument.Parse(message.WrittenMemory); await input.Writer.WriteAsync(parsed.RootElement.Clone(), stop.Token);
            }
        }
        catch (Exception error) when (error is WebSocketException or OperationCanceledException or IOException) { }
        finally { input.Writer.TryComplete(); }
    }
    public async Task<JsonElement> Receive() => await input.Reader.ReadAsync(stop.Token).AsTask().WaitAsync(TimeSpan.FromSeconds(5));
    public Task Send(string json, bool binary = false, int fragment = 65536) => Send(Encoding.UTF8.GetBytes(json), binary, fragment);
    public async Task Send(byte[] bytes, bool binary = false, int fragment = 65536)
    {
        var socket = await connected.Task.WaitAsync(TimeSpan.FromSeconds(5)); await writing.WaitAsync(stop.Token);
        try
        {
            for (var position = 0; position < bytes.Length; position += fragment)
            {
                var count = Math.Min(fragment, bytes.Length - position);
                await socket.SendAsync(bytes.AsMemory(position, count), binary ? WebSocketMessageType.Binary : WebSocketMessageType.Text, position + count == bytes.Length, stop.Token);
            }
        }
        finally { writing.Release(); }
    }
    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync(); if (connected.Task.IsCompletedSuccessfully) connected.Task.Result.Abort();
        await server.StopAsync(); await server.DisposeAsync(); writing.Dispose(); stop.Dispose();
        if (directory is not null) Directory.Delete(directory, recursive: true);
    }
}
