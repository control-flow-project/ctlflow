using Crossfire.Kernel;
using System.Text.Json;
using System.Threading.Channels;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterPi;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Crossfire.Runtime.Tests;

public sealed record PiProviderCall(JsonElement Input, bool Held, TaskCompletionSource Release);

public sealed class PiProvider : IAsyncDisposable
{
    private sealed record Tool(string Name, JsonElement Arguments);
    private readonly WebApplication app;
    private readonly Channel<PiProviderCall> calls = Channel.CreateUnbounded<PiProviderCall>();
    private readonly CancellationTokenSource stop = new();
    private int hold;
    private int requests;
    private Tool? tool;
    public string Host { get; }
    public int Requests => Volatile.Read(ref requests);
    public ChannelReader<PiProviderCall> Calls => calls.Reader;
    private PiProvider(WebApplication app, string host) { this.app = app; Host = host; app.Run(Respond); }
    public static async Task<PiProvider> Start(string directory)
    {
        var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0"); builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 8388608);
        var fixture = new PiProvider(builder.Build(), PrivateFiles.Directory(Path.Combine(directory, "host")));
        try
        {
            await fixture.app.StartAsync(); PrivateFiles.Write(Path.Combine(fixture.Host, "auth.json"), "{}"u8, 65536);
            var models = "{\"providers\":{\"fixture\":{\"baseUrl\":\"" + fixture.app.Urls.Single() + "/v1\",\"api\":\"openai-completions\",\"apiKey\":\"fixture\",\"models\":["
                + "{\"id\":\"fixture-model\",\"name\":\"Inert Pi fixture\",\"reasoning\":true,\"input\":[\"text\"],\"cost\":{\"input\":0,\"output\":0,\"cacheRead\":0,\"cacheWrite\":0},\"contextWindow\":128000,\"maxTokens\":8192},"
                + "{\"id\":\"plain-model\",\"name\":\"No reasoning fixture\",\"reasoning\":false}]}}}";
            PrivateFiles.Write(Path.Combine(fixture.Host, "models.json"), System.Text.Encoding.UTF8.GetBytes(models), 1048576); return fixture;
        }
        catch { await fixture.DisposeAsync(); throw; }
    }
    public void Hold() => Interlocked.Exchange(ref hold, 1);
    public void NextTool(string name, JsonElement arguments) => Interlocked.Exchange(ref tool, new(name, arguments.Clone()));
    private static string Chunk(int sequence, Action<ProtocolWriter> delta, string? finish = null, bool usage = false)
        => PiValues.Object(writer =>
        {
            writer.WriteString("id", "chat-" + sequence); writer.WriteStartArray("choices"); writer.WriteStartObject(); writer.WriteNumber("index", 0); writer.WritePropertyName("delta");
            writer.WriteStartObject(); delta(writer); writer.WriteEndObject(); writer.WriteString("finish_reason", finish); writer.WriteEndObject(); writer.WriteEndArray();
            if (usage) { writer.WriteStartObject("usage"); writer.WriteNumber("prompt_tokens", 5); writer.WriteNumber("completion_tokens", 3); writer.WriteNumber("total_tokens", 8);
                writer.WriteStartObject("prompt_tokens_details"); writer.WriteNumber("cached_tokens", 2); writer.WriteEndObject(); writer.WriteEndObject(); }
        }).GetRawText();
    private static ValueTask Emit(HttpContext http, string value, CancellationToken cancellation) => new(http.Response.WriteAsync("data: " + value + "\n\n", cancellation));
    private async Task Respond(HttpContext http)
    {
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(stop.Token, http.RequestAborted);
        if (http.Request.Method != "POST" || http.Request.Path != "/v1/chat/completions") { http.Response.StatusCode = 404; return; }
        try
        {
            using var document = await JsonDocument.ParseAsync(http.Request.Body, cancellationToken: scope.Token); var sequence = Interlocked.Increment(ref requests);
            var call = new PiProviderCall(document.RootElement.Clone(), Interlocked.Exchange(ref hold, 0) != 0, new(TaskCreationOptions.RunContinuationsAsynchronously));
            http.Response.ContentType = "text/event-stream"; await Emit(http, Chunk(sequence, writer => writer.WriteString("role", "assistant")), scope.Token); await http.Response.Body.FlushAsync(scope.Token);
            calls.Writer.TryWrite(call); if (call.Held) await call.Release.Task.WaitAsync(scope.Token); var selected = Interlocked.Exchange(ref tool, null);
            await Emit(http, Chunk(sequence, writer =>
            {
                if (selected is null) writer.WriteString("content", "Fixture complete.");
                else { writer.WriteStartArray("tool_calls"); writer.WriteStartObject(); writer.WriteNumber("index", 0); writer.WriteString("id", "call-" + sequence); writer.WriteString("type", "function");
                    writer.WriteStartObject("function"); writer.WriteString("name", selected.Name); writer.WriteString("arguments", selected.Arguments.GetRawText()); writer.WriteEndObject(); writer.WriteEndObject(); writer.WriteEndArray(); }
            }), scope.Token);
            await Emit(http, Chunk(sequence, _ => { }, selected is null ? "stop" : "tool_calls", true), scope.Token); await Emit(http, "[DONE]", scope.Token);
        }
        catch (OperationCanceledException) when (scope.IsCancellationRequested) { }
    }
    public async ValueTask DisposeAsync() { await stop.CancelAsync(); await app.StopAsync(); await app.DisposeAsync(); stop.Dispose(); }
}
