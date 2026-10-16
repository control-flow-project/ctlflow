using System.Buffers;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed class WebSocketProtocol : CodexProtocol
{
    public const int MaximumFrameBytes = 8388608;
    private sealed record Pending(TaskCompletionSource<NativeReply> Response, CancellationTokenSource Deadline) { public bool Sent { get; set; } }
    private sealed record Decision(CancellationTokenSource Stop, NativeRequest Request, TaskCompletionSource Finished);
    private readonly ClientWebSocket socket;
    private readonly HttpClient client;
    private readonly NativeCallbacks callbacks;
    private readonly CancellationTokenSource stop = new();
    private readonly CancellationTokenRegistration cancellation;
    private readonly SemaphoreSlim writing = new(1);
    private readonly Dictionary<long, Pending> pending = [];
    private readonly Dictionary<string, Decision> decisions = new(StringComparer.Ordinal);
    private readonly object gate = new();
    private readonly int timeout;
    private readonly TimeProvider time;
    private readonly Task reading;
    private Failure? failure;
    private long sequence;
    private Task? closing;
    private int operations;
    private readonly TaskCompletionSource drained = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public CancellationToken Lifetime { get; }

    private WebSocketProtocol(ClientWebSocket socket, HttpClient client, NativeCallbacks callbacks, int timeout, CancellationToken cancellation, TimeProvider time)
    {
        this.socket = socket; this.client = client; this.callbacks = callbacks; this.timeout = timeout; this.time = time; Lifetime = stop.Token;
        this.cancellation = cancellation.Register(() => Fail(new("native", "Owned Codex connection was cancelled")));
        reading = Read();
    }

    public static async ValueTask<Result<WebSocketProtocol>> Open(string endpoint, string token, int timeout, NativeCallbacks callbacks, CancellationToken cancellation = default, TimeProvider? time = null)
    {
        if (timeout is < 100 or > 300000 || token.Length > 4096 || token.Any(character => character is <= '\u0020' or '\u007f' || TextRules.WhiteSpace(character)))
            return Results.Fail<WebSocketProtocol>("invalid", "Invalid native Codex deadline or bearer token");
        ClientWebSocket? socket = null; HttpClient? client = null; SocketsHttpHandler? handler = null;
        try
        {
            handler = new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, UseProxy = false, AutomaticDecompression = DecompressionMethods.None, ConnectTimeout = TimeSpan.FromMilliseconds(timeout) };
            Uri destination;
            if (endpoint.StartsWith("unix://", StringComparison.Ordinal))
            {
                var path = PrivateFiles.UnixSocket(endpoint[7..]); destination = new("ws://localhost/rpc");
                handler.ConnectCallback = async (_, stopped) =>
                {
                    var connection = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                    try { await connection.ConnectAsync(new UnixDomainSocketEndPoint(path), stopped); return new NetworkStream(connection, ownsSocket: true); }
                    catch { connection.Dispose(); throw; }
                };
            }
            else
            {
                if (!Uri.TryCreate(endpoint, UriKind.Absolute, out destination!) || destination.Scheme is not ("ws" or "wss") || destination.Host is not ("127.0.0.1" or "localhost" or "[::1]")
                    || destination.UserInfo.Length != 0 || destination.Query.Length != 0 || destination.Fragment.Length != 0 || destination.AbsolutePath != "/" || token.Length == 0)
                { handler.Dispose(); return Results.Fail<WebSocketProtocol>("invalid", "Codex requires an explicit loopback WebSocket or private Unix socket"); }
            }
            client = new(handler) { Timeout = Timeout.InfiniteTimeSpan }; socket = new();
            if (!endpoint.StartsWith("unix://", StringComparison.Ordinal)) socket.Options.SetRequestHeader("Authorization", "Bearer " + token);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(timeout);
            await socket.ConnectAsync(destination, client, deadline.Token);
            return Result<WebSocketProtocol>.Success(new(socket, client, callbacks, timeout, cancellation, time ?? TimeProvider.System));
        }
        catch (Exception error) when (error is WebSocketException or IOException or SocketException or OperationCanceledException or ArgumentException)
        { socket?.Dispose(); client?.Dispose(); handler?.Dispose(); return Results.Fail<WebSocketProtocol>("native", "Codex WebSocket connection failed"); }
    }

    private static void Require(bool condition, string message) { if (!condition) throw new InvalidDataException(message); }
    private void Fail(Failure reason)
    {
        Pending[] requests;
        lock (gate)
        {
            if (failure is not null) return; failure = reason;
            requests = pending.Values.ToArray(); pending.Clear();
        }
        try { stop.Cancel(); }
        finally
        {
            socket.Abort();
            foreach (var request in requests) { request.Deadline.Dispose(); request.Response.TrySetCanceled(Lifetime); }
        }
    }
    private Failure Error { get { lock (gate) return failure ?? new("native", "Codex operation was cancelled before confirmation"); } }
    private static bool Recoverable(Exception error) => error is not (OutOfMemoryException or StackOverflowException or AccessViolationException);
    private bool Enter()
    {
        lock (gate) { if (failure is not null) return false; operations++; return true; }
    }
    private void Leave()
    {
        lock (gate) { operations--; if (operations == 0 && failure is not null) drained.TrySetResult(); }
    }

    private async Task Read()
    {
        var buffer = ArrayPool<byte>.Shared.Rent(65536);
        try
        {
            while (!Lifetime.IsCancellationRequested)
            {
                var output = new ArrayBufferWriter<byte>(); ValueWebSocketReceiveResult frame;
                do
                {
                    frame = await socket.ReceiveAsync(buffer.AsMemory(0, 65536), Lifetime);
                    if (frame.MessageType == WebSocketMessageType.Close) throw new IOException("Codex disconnected");
                    Require(frame.MessageType == WebSocketMessageType.Text && output.WrittenCount + frame.Count <= MaximumFrameBytes, "Invalid or oversized Codex frame");
                    output.Write(buffer.AsSpan(0, frame.Count));
                } while (!frame.EndOfMessage);
                using var document = JsonDocument.Parse(output.WrittenMemory, new JsonDocumentOptions { MaxDepth = 128 });
                Receive(document.RootElement);
            }
        }
        catch (Exception error) when (Recoverable(error))
        { Fail(new("native", "Codex native transport failed: " + error.GetType().Name)); }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
    }

    private void Receive(JsonElement message)
    {
        Require(message.ValueKind == JsonValueKind.Object, "Invalid native protocol object");
        if (message.TryGetProperty("method", out var method))
        {
            Require(method.ValueKind == JsonValueKind.String && message.TryGetProperty("params", out var body) && body.ValueKind == JsonValueKind.Object, "Invalid native event");
            var parameters = message.GetProperty("params").Clone(); var name = method.GetString()!;
            if (!message.TryGetProperty("id", out var identity))
            {
                Decision[] ended;
                lock (gate)
                {
                    ended = decisions.Values.Where(decision =>
                    {
                        var request = decision.Request.Parameters;
                        return name == "serverRequest/resolved" && parameters.TryGetProperty("requestId", out var resolved) && CodexJson.Identity(resolved) == CodexJson.Identity(decision.Request.Id)
                            || name is "thread/closed" or "turn/completed" && Same(parameters, "threadId", request, "threadId")
                                && (name == "thread/closed" || parameters.TryGetProperty("turn", out var turn) && Same(turn, "id", request, "turnId"));
                    }).ToArray();
                }
                foreach (var decision in ended) Cancel(decision);
                callbacks.Event(new(name, parameters)); return;
            }
            var key = CodexJson.Identity(identity); var requestValue = new NativeRequest(identity.Clone(), name, parameters); Decision decisionValue;
            lock (gate)
            {
                Require(decisions.Count < 16 && !decisions.ContainsKey(key), "Duplicate or excessive native decision");
                decisionValue = new(CancellationTokenSource.CreateLinkedTokenSource(Lifetime), requestValue, new(TaskCreationOptions.RunContinuationsAsynchronously)); decisions.Add(key, decisionValue);
            }
            _ = Answer(key, decisionValue); return;
        }
        Require(message.TryGetProperty("id", out var id) && CodexJson.Integer(id, out var identityNumber) && identityNumber >= 1, "Invalid native response identity");
        CodexJson.Integer(id, out var number); NativeReply reply;
        if (message.TryGetProperty("error", out var error))
        {
            Require(!message.TryGetProperty("result", out _) && error.ValueKind == JsonValueKind.Object && error.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.Number && code.TryGetInt64(out _) && error.TryGetProperty("message", out var text) && text.ValueKind == JsonValueKind.String, "Invalid native error response");
            reply = new(null, new(error.GetProperty("code").GetInt64(), error.GetProperty("message").GetString()!));
        }
        else { Require(message.TryGetProperty("result", out var value), "Native response has no result"); reply = new(value.Clone(), null); }
        Pending selected;
        lock (gate) { Require(pending.Remove(number, out selected!), "Unexpected native response identity"); }
        selected.Deadline.Dispose(); selected.Response.TrySetResult(reply);
    }
    private static bool Same(JsonElement first, string firstName, JsonElement second, string secondName)
        => first.TryGetProperty(firstName, out var firstValue) && second.TryGetProperty(secondName, out var secondValue) && JsonElement.DeepEquals(firstValue, secondValue);
    private static void Cancel(Decision decision)
    {
        try { decision.Stop.Cancel(); }
        catch (ObjectDisposedException) when (decision.Finished.Task.IsCompleted) { }
    }
    private async Task Answer(string key, Decision decision)
    {
        try
        {
            var result = await callbacks.Decision(decision.Request, decision.Stop.Token).AsTask().WaitAsync(decision.Stop.Token);
            if (decision.Stop.IsCancellationRequested) return;
            var frame = CodexJson.Object(writer =>
            {
                writer.WritePropertyName("id"); decision.Request.Id.WriteTo(writer);
                if (result.IsSuccess) { writer.WritePropertyName("result"); result.Value.WriteTo(writer); }
                else { writer.WriteStartObject("error"); writer.WriteNumber("code", -32602); writer.WriteString("message", result.Error.Message); writer.WriteEndObject(); }
            });
            await Send(frame, decision.Stop.Token); if (result.IsSuccess) callbacks.Responded(decision.Request);
        }
        catch (OperationCanceledException) when (decision.Stop.IsCancellationRequested) { }
        catch (Exception error) when (Recoverable(error)) { Fail(new("native", "Native decision response failed")); }
        finally { lock (gate) decisions.Remove(key); decision.Stop.Dispose(); decision.Finished.TrySetResult(); }
    }
    private async ValueTask Send(JsonElement value, CancellationToken cancellation, Pending? request = null)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(value.GetRawText()); Require(bytes.Length <= MaximumFrameBytes, "Native request exceeds its byte bound");
        await writing.WaitAsync(cancellation);
        try
        {
            cancellation.ThrowIfCancellationRequested(); Lifetime.ThrowIfCancellationRequested();
            if (request is not null) lock (gate) request.Sent = true;
            await socket.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, Lifetime);
        }
        finally { writing.Release(); }
    }
    public async ValueTask<Result<NativeReply>> Request(string method, JsonElement parameters, CancellationToken cancellation = default)
    {
        if (parameters.ValueKind != JsonValueKind.Object || method.Length is < 1 or > 200 || method.Any(char.IsControl)) return Results.Fail<NativeReply>("invalid", "Invalid native request");
        if (cancellation.IsCancellationRequested || Lifetime.IsCancellationRequested) return Result<NativeReply>.Fail(Error);
        if (!Enter()) return Result<NativeReply>.Fail(Error);
        try { return await Exchange(method, parameters, cancellation); }
        finally { Leave(); }
    }
    private async ValueTask<Result<NativeReply>> Exchange(string method, JsonElement parameters, CancellationToken cancellation)
    {
        Pending request; long id;
        lock (gate)
        {
            if (pending.Count >= 64 || sequence >= 9007199254740991 || failure is not null) return Results.Fail<NativeReply>("unavailable", "Native request capacity is unavailable");
            id = ++sequence; request = new(new(TaskCreationOptions.RunContinuationsAsynchronously), new(TimeSpan.FromMilliseconds(timeout), time)); pending.Add(id, request);
            request.Deadline.Token.Register(() => Fail(new("native", "Codex " + method + " timed out; delivery may be uncertain. Read positions were not advanced.")));
        }
        try
        {
            await Send(CodexJson.Object(writer => { writer.WriteNumber("id", id); writer.WriteString("method", method); writer.WritePropertyName("params"); parameters.WriteTo(writer); }), cancellation, request);
            return Result<NativeReply>.Success(await request.Response.Task.WaitAsync(cancellation));
        }
        catch (OperationCanceledException)
        {
            lock (gate) if (!request.Sent && pending.Remove(id)) request.Deadline.Dispose();
            return Result<NativeReply>.Fail(Error);
        }
        catch (Exception error) when (Recoverable(error))
        { Fail(new("native", "Codex native write failed")); return Result<NativeReply>.Fail(Error); }
    }
    public async ValueTask<Result<Unit>> Notify(string method, CancellationToken cancellation = default)
    {
        if (method.Length is < 1 or > 200 || method.Any(char.IsControl)) return Results.Fail<Unit>("invalid", "Invalid native notification");
        if (!Enter()) return Result<Unit>.Fail(Error);
        try { await Send(CodexJson.Object(writer => writer.WriteString("method", method)), cancellation); return Results.Done(); }
        catch (Exception error) when (Recoverable(error))
        { Fail(new("native", "Codex native notification failed")); return Result<Unit>.Fail(Error); }
        finally { Leave(); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = FinishClose(completion);
        return new(selected);
    }
    private async Task FinishClose(TaskCompletionSource completion)
    {
        try { await Close(); completion.TrySetResult(); }
        catch (Exception error) when (Recoverable(error)) { completion.TrySetException(error); }
    }
    private async Task Close()
    {
        Fail(new("native", "Codex connection closed")); cancellation.Dispose(); await reading;
        Task[] answers; Task active;
        lock (gate) { answers = decisions.Values.Select(decision => decision.Finished.Task).ToArray(); active = operations == 0 ? Task.CompletedTask : drained.Task; }
        await Task.WhenAll(answers); await active; socket.Dispose(); client.Dispose(); writing.Dispose(); stop.Dispose();
    }
}
