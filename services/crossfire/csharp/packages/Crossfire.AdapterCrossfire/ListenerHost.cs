using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Crossfire.AdapterCrossfire;

public sealed class ListenerBinding : IDisposable
{
    internal readonly string Name, Release, Secret, File;
    internal readonly Func<string> Session;
    internal readonly Action Stop;
    internal Func<CancellationToken, ValueTask<Result<JsonElement>>>? Diagnose;
    internal HistoryQueries? Queries;
    private readonly Action<ListenerBinding> close;
    private int closed;
    internal ListenerBinding(string name, string release, string file, Func<string> session, Action stop, Action<ListenerBinding> close)
    { Name = name; Release = release; File = file; Session = session; Stop = stop; this.close = close; Secret = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)); }
    public void Ready(Func<CancellationToken, ValueTask<Result<JsonElement>>> test, HistoryQueries queries) { Diagnose = test; Queries = queries; }
    public void Dispose() { if (Interlocked.Exchange(ref closed, 1) == 0) close(this); }
}

public sealed class ListenerHost : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly LocalState storage;
    private readonly Dictionary<string, ListenerBinding> bindings = new(StringComparer.Ordinal);
    private readonly object gate = new();
    private readonly SemaphoreSlim requests = new(16, 16);
    private bool closing;
    private int port;
    public ListenerBudget Budget { get; } = new();
    private ListenerHost(WebApplication app, LocalState storage) { this.app = app; this.storage = storage; }
    public static async ValueTask<ListenerHost> Start(LocalState storage, CancellationToken cancellation)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ApplicationName = typeof(ListenerHost).Assembly.GetName().Name }); builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => { options.Listen(IPAddress.Loopback, 0); options.Limits.MaxConcurrentConnections = 32; options.Limits.MaxRequestBodySize = 65536; options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10); options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(5); });
        var app = builder.Build(); var host = new ListenerHost(app, storage); app.Run(host.Handle);
        try { await app.StartAsync(cancellation); var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses; host.port = new Uri(addresses?.Single() ?? throw new IOException("Cannot open private listener host")).Port; return host; } catch { await app.DisposeAsync(); host.requests.Dispose(); host.Budget.Dispose(); throw; }
    }
    public ListenerBinding Bind(string name, string release, string cursorFile, Func<string> session, Action stop)
    {
        lock (gate)
        {
            if (closing || bindings.Count >= 10000 || bindings.ContainsKey(name) || name.Length is < 1 or > 255 || !name.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-')) throw new InvalidDataException("Invalid or duplicate listener host binding");
            var value = new ListenerBinding(name, release, Path.Combine(Path.GetDirectoryName(cursorFile)!, "listener.json"), session, stop, Unbind); AgentIO.Write(storage, value.File, WireJson.Object(writer => { writer.WriteNumber("port", port); writer.WriteString("secret", value.Secret); writer.WriteString("binding", name); })); bindings.Add(name, value); return value;
        }
    }
    private void Unbind(ListenerBinding binding) { lock (gate) { if (bindings.TryGetValue(binding.Name, out var value) && ReferenceEquals(value, binding)) { bindings.Remove(binding.Name); binding.Diagnose = null; binding.Queries = null; AgentIO.Remove(storage, binding.File); } } }
    private async Task Handle(HttpContext context)
    {
        context.Response.ContentType = "application/json"; context.Response.Headers.Connection = "close";
        var path = context.Request.Path.Value?.Split('/'); ListenerBinding? binding; lock (gate) binding = !closing && path is { Length: 4 } && path[0] == "" && path[1] == "bindings" && path[3] == "control" ? bindings.GetValueOrDefault(path[2]) : null;
        var authorization = context.Request.Headers.Authorization.ToString(); var token = authorization.StartsWith("Bearer ", StringComparison.Ordinal) ? authorization[7..] : "";
        if (context.Request.Method != "POST" || binding is null || context.Request.Headers.ContainsKey("Origin") || token.Length != 64 || token.Any(character => character is not (>= 'a' and <= 'f' or >= '0' and <= '9')) || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(token), Encoding.ASCII.GetBytes(binding.Secret))) { context.Response.StatusCode = 403; return; }
        if (!requests.Wait(0)) { context.Response.StatusCode = 429; await Write(context, WireJson.Object(writer => writer.WriteString("error", "Listener host request capacity reached"))); return; }
        var query = false;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted); deadline.CancelAfter(45000);
        try
        {
            var collected = await NativeHttp.Collect(context.Request.Body, 65536, deadline.Token); if (!collected.IsSuccess) { context.Response.StatusCode = 400; await Write(context, WireJson.Object(writer => writer.WriteString("error", collected.Error.Message))); return; }
            var input = WireJson.Parse(collected.Value); var action = WireJson.Text(input, "action"); var expected = action == "read" ? new[] { "action", "input" } : action == "acknowledge" ? ["action", "queryId"] : ["action"];
            if (!Validation.Fields(input, expected).IsSuccess || action is not ("read" or "acknowledge" or "status" or "stop" or "test")) { context.Response.StatusCode = 400; await Write(context, WireJson.Object(writer => writer.WriteString("error", "Invalid listener action or fields"))); return; }
            if (action is "read" or "acknowledge")
            {
                query = true; Result<JsonElement> result;
                if (binding.Queries is null) result = Results.Fail<JsonElement>("unavailable", "Listener is not ready");
                else if (action == "read") { var parsed = HistoryQueries.Parse(input.GetProperty("input")); result = parsed.IsSuccess ? await binding.Queries.Read(parsed.Value, deadline.Token) : Result<JsonElement>.Fail(parsed.Error); }
                else { var id = WireJson.Text(input, "queryId"); result = id is { Length: <= 255 } ? await binding.Queries.Acknowledge(id, deadline.Token) : Results.Fail<JsonElement>("invalid", "Invalid history acknowledgment"); }
                context.Response.StatusCode = result.IsSuccess ? 200 : 409; await Write(context, Result(result)); return;
            }
            if (action == "stop") binding.Stop(); JsonElement? diagnostic = null;
            if (action == "test") { if (binding.Diagnose is null) throw new InvalidOperationException("Listener is not ready"); var result = await binding.Diagnose(deadline.Token); if (!result.IsSuccess) throw new InvalidOperationException(result.Error.Message); diagnostic = result.Value; }
            await Write(context, WireJson.Object(writer => { writer.WriteString("release", binding.Release); writer.WriteString("binding", binding.Name); writer.WriteString("session", binding.Session()); writer.WriteBoolean("ready", binding.Diagnose is not null); if (diagnostic is { } value) { writer.WritePropertyName("test"); value.WriteTo(writer); } }));
        }
        catch (Exception error) when (error is JsonException or IOException or InvalidDataException or InvalidOperationException or OperationCanceledException or ArgumentException)
        {
            if (!context.Response.HasStarted && !context.RequestAborted.IsCancellationRequested) { context.Response.StatusCode = 400; var message = TextRules.TruncateUtf16(error.Message, 1024); await Write(context, query ? Result(Results.Fail<JsonElement>("unavailable", message)) : WireJson.Object(writer => writer.WriteString("error", message))); }
        }
        finally { requests.Release(); }
    }
    public static JsonElement Result(Result<JsonElement> value) => WireJson.Object(writer => { writer.WriteBoolean("ok", value.IsSuccess); if (value.IsSuccess) { writer.WritePropertyName("value"); value.Value.WriteTo(writer); } else { writer.WriteStartObject("error"); writer.WriteString("code", value.Error.Code); writer.WriteString("message", value.Error.Message); writer.WriteEndObject(); } });
    private static async Task Write(HttpContext context, JsonElement value)
    { var bytes = WireJson.Bytes(value); if (bytes.Length > 1048576) throw new InvalidDataException("Listener query result exceeds its resource bound"); context.Response.ContentLength = bytes.Length; await context.Response.Body.WriteAsync(bytes, context.RequestAborted); }
    public async ValueTask DisposeAsync()
    {
        lock (gate) { if (closing) return; if (bindings.Count != 0) throw new InvalidOperationException("Close listener bindings before closing their host"); closing = true; }
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(45)); try { await app.StopAsync(deadline.Token); await app.DisposeAsync(); } finally { Budget.Dispose(); requests.Dispose(); }
    }
}
