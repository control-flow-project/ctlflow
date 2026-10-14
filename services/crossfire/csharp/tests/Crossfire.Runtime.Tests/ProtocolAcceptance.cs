using System.Text.Json;
using System.Threading.Channels;
using Crossfire.AdapterCodex;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class ProtocolAcceptance
{
    private static JsonElement Json(string text) { using var value = JsonDocument.Parse(text); return value.RootElement.Clone(); }
    private static NativeCallbacks Callbacks(Action<NativeEvent>? onEvent = null) => new(onEvent ?? (_ => { }),
        (_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("invalid", "No permission was requested by this test")), _ => { });
    private static async Task<WebSocketProtocol> Connect(ProtocolFixture fixture, NativeCallbacks? callbacks = null)
    {
        var opened = await WebSocketProtocol.Open(fixture.Endpoint, ProtocolFixture.Token, 10000, callbacks ?? Callbacks());
        Equal(opened.IsSuccess, true, "native WebSocket connects with private authority"); return opened.Value;
    }
    private static async Task<Result<NativeReply>> Roundtrip(ProtocolFixture fixture, WebSocketProtocol protocol, string method, string result)
    {
        var pending = protocol.Request(method, Json("{}")).AsTask(); var request = await fixture.Receive();
        Equal(request.GetProperty("method").GetString(), method, "native method is not rewritten");
        await fixture.Send("{\"id\":" + request.GetProperty("id").GetRawText() + ",\"result\":" + result + "}");
        return await pending.WaitAsync(TimeSpan.FromSeconds(5));
    }
    public static async Task Verify()
    {
        await Ordinary(); await Cancelled(); await Decisions(); await Capacity(); await Deadline();
        foreach (var invalid in new[] { "{\"id\":1}", "{\"id\":1,\"error\":{}}", "{\"id\":1,\"error\":{\"code\":1,\"message\":\"bad\"},\"result\":{}}",
            "{\"id\":null,\"result\":{}}", "{\"id\":999,\"result\":{}}", "[]", "not JSON", "{\"method\":\"event\",\"params\":[]}" }) await Corruption(invalid);
        await Corruption("{\"id\":1,\"result\":{}}", binary: true);
        await Corruption(new byte[] { 0xc0, 0xaf });
        var invalidUtf8 = System.Text.Encoding.UTF8.GetBytes("{\"method\":\"native\",\"params\":{\"text\":\"").Concat(new byte[] { 0xc0, 0xaf }).Concat("\"}}"u8.ToArray()).ToArray();
        await Corruption(invalidUtf8);
        await UnixSocket();
        var callbacks = Callbacks();
        foreach (var endpoint in new[] { "ws://example.com/", "ws://127.0.0.1/path", "ws://127.0.0.1/?token=secret", "http://127.0.0.1/", "unix://relative/socket" })
            Equal((await WebSocketProtocol.Open(endpoint, ProtocolFixture.Token, 1000, callbacks)).IsSuccess, false, "non-private native endpoint is refused");
        Equal((await WebSocketProtocol.Open("ws://127.0.0.1/", "unsafe\nheader", 1000, callbacks)).IsSuccess, false, "bearer token rejects header injection");
        Equal((await WebSocketProtocol.Open("ws://127.0.0.1/", ProtocolFixture.Token, 99, callbacks)).IsSuccess, false, "native deadline is bounded");
    }
    private static async Task Ordinary()
    {
        await using var fixture = await ProtocolFixture.Open(); var events = Channel.CreateUnbounded<NativeEvent>();
        await using var protocol = await Connect(fixture, Callbacks(value => events.Writer.TryWrite(value)));
        var response = await Roundtrip(fixture, protocol, "initialize", "{\"selected\":\"exact\"}");
        Equal(response.Value.Value!.Value.GetProperty("selected").GetString(), "exact", "native response bytes survive document disposal");
        Equal((await protocol.Notify("initialized")).IsSuccess, true, "native initialization notification");
        Equal((await fixture.Receive()).TryGetProperty("id", out _), false, "notification does not invent a request identity");
        var text = string.Concat(Enumerable.Repeat("Evidence € 文 ", 3000));
        await fixture.Send("{\"method\":\"item/started\",\"params\":{\"changes\":" + ProtocolJson.Quote(text) + "}}", fragment: 7);
        var received = await events.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
        Equal(received.Parameters.GetProperty("changes").GetString() == text, true, "large fragmented UTF-8 notification is not limited by approval text bounds");
        var failed = protocol.Request("native-error", Json("{}")).AsTask(); var request = await fixture.Receive();
        await fixture.Send("{\"id\":" + request.GetProperty("id").GetRawText() + ",\"error\":{\"code\":-32602,\"message\":\"unsupported settings\"}}");
        var error = await failed.WaitAsync(TimeSpan.FromSeconds(5)); Equal(error.IsSuccess, true, "native rejection is distinct from transport uncertainty");
        Equal(error.Value.Error!.Code, -32602L, "native error code is retained"); Equal(error.Value.Error.Message, "unsupported settings", "native error detail is retained");
        Equal((await Roundtrip(fixture, protocol, "still-connected", "null")).IsSuccess, true, "native rejection does not break the connection");
    }
    private static async Task Cancelled()
    {
        await using var fixture = await ProtocolFixture.Open(); await using var protocol = await Connect(fixture);
        using var stopped = new CancellationTokenSource(); var request = protocol.Request("turn/start", Json("{}"), stopped.Token).AsTask(); var sent = await fixture.Receive();
        await stopped.CancelAsync(); Equal((await request.WaitAsync(TimeSpan.FromSeconds(5))).IsSuccess, false, "caller stops waiting without claiming delivery");
        await fixture.Send("{\"id\":" + sent.GetProperty("id").GetRawText() + ",\"result\":{\"turn\":\"already-sent\"}}");
        Equal((await Roundtrip(fixture, protocol, "thread/read", "{}")).IsSuccess, true, "late confirmation stays correlated after caller cancellation");
        using var before = new CancellationTokenSource(); before.Cancel();
        Equal((await protocol.Request("not-sent", Json("{}"), before.Token)).IsSuccess, false, "cancelled input is not sent");
        var pending = protocol.Request("pending-on-close", Json("{}")).AsTask(); await fixture.Receive();
        await Task.WhenAll(protocol.DisposeAsync().AsTask(), protocol.DisposeAsync().AsTask()).WaitAsync(TimeSpan.FromSeconds(5));
        Equal((await pending).IsSuccess, false, "close releases all request waiters");
        Equal((await protocol.Request("after-close", Json("{}"))).IsSuccess, false, "closed transport cannot restart implicitly");
    }
    private static async Task Decisions()
    {
        await using var fixture = await ProtocolFixture.Open(); var questions = Channel.CreateUnbounded<NativeRequest>(); var cancelled = Channel.CreateUnbounded<string>(); var responded = 0;
        async ValueTask<Result<JsonElement>> Decide(NativeRequest request, CancellationToken cancellation)
        {
            await questions.Writer.WriteAsync(request, cancellation);
            if (request.Id.GetString() == "allow") return Result<JsonElement>.Success(Json("{\"decision\":\"accept\"}"));
            if (request.Id.GetString() == "deny") return Results.Fail<JsonElement>("forbidden", "Owner declined");
            try { await new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously).Task.WaitAsync(cancellation); }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { cancelled.Writer.TryWrite(request.Id.GetString()!); throw; }
            return Result<JsonElement>.Success(Json("{}"));
        }
        await using var protocol = await Connect(fixture, new(_ => { }, Decide, _ => Interlocked.Increment(ref responded)));
        await fixture.Send("{\"id\":\"allow\",\"method\":\"item/tool/requestUserInput\",\"params\":{}}"); await questions.Reader.ReadAsync();
        var answer = await fixture.Receive(); Equal(answer.GetProperty("result").GetProperty("decision").GetString(), "accept", "decision writes exact native choice");
        await fixture.Send("{\"id\":\"deny\",\"method\":\"item/tool/requestUserInput\",\"params\":{}}"); await questions.Reader.ReadAsync();
        Equal((await fixture.Receive()).GetProperty("error").GetProperty("code").GetInt32(), -32602, "unsupported decision is an explicit native error");
        await Roundtrip(fixture, protocol, "decision-barrier", "{}"); Equal(responded, 1, "responded callback follows only successful native writes");
        foreach (var control in new[] { "serverRequest/resolved", "turn/completed", "thread/closed" })
        {
            await fixture.Send("{\"id\":" + ProtocolJson.Quote(control) + ",\"method\":\"item/tool/requestUserInput\",\"params\":{\"threadId\":\"thread\",\"turnId\":\"turn\"}}"); await questions.Reader.ReadAsync();
            var body = control == "serverRequest/resolved" ? "{\"requestId\":" + ProtocolJson.Quote(control) + "}" : "{\"threadId\":\"thread\",\"turn\":{\"id\":\"turn\"}}";
            await fixture.Send("{\"method\":" + ProtocolJson.Quote(control) + ",\"params\":" + body + "}");
            Equal(await cancelled.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5)), control, "ended native question is withdrawn");
        }
        Equal((await Roundtrip(fixture, protocol, "after-withdrawal", "{}")).IsSuccess, true, "question cancellation does not fail unrelated work");
    }
    private static async Task Capacity()
    {
        await using var fixture = await ProtocolFixture.Open(); await using var protocol = await Connect(fixture); var requests = new List<Task<Result<NativeReply>>>(); var ids = new List<long>();
        for (var index = 0; index < 64; index++) { requests.Add(protocol.Request("concurrent", Json("{}")).AsTask()); ids.Add((await fixture.Receive()).GetProperty("id").GetInt64()); }
        Equal((await protocol.Request("overflow", Json("{}"))).Error.Code, "unavailable", "native in-flight request bound is enforced");
        foreach (var id in ids.AsEnumerable().Reverse()) await fixture.Send("{\"id\":" + id + ",\"result\":{}}");
        Equal((await Task.WhenAll(requests).WaitAsync(TimeSpan.FromSeconds(5))).All(value => value.IsSuccess), true, "out-of-order confirmations retain every request identity");
    }
    private static async Task Deadline()
    {
        await using var fixture = await ProtocolFixture.Open(); var time = new ManualTime();
        var opened = await WebSocketProtocol.Open(fixture.Endpoint, ProtocolFixture.Token, 10000, Callbacks(), time: time);
        Equal(opened.IsSuccess, true, "controlled-clock native connection"); await using var protocol = opened.Value;
        var waiting = protocol.Request("unconfirmed", Json("{}")).AsTask(); await fixture.Receive();
        time.Advance(TimeSpan.FromMilliseconds(9999)); Equal(waiting.IsCompleted, false, "native deadline is not shortened");
        time.Advance(TimeSpan.FromMilliseconds(1)); var expired = await waiting.WaitAsync(TimeSpan.FromSeconds(5));
        Equal(expired.IsSuccess, false, "unconfirmed native request fails at its exact deadline");
        Equal(expired.Error.Message.Contains("delivery may be uncertain", StringComparison.Ordinal), true, "deadline does not invent confirmation");
        Equal(protocol.Lifetime.IsCancellationRequested, true, "uncertain transport stops before further publication");
    }
    private static Task Corruption(string frame, bool binary = false) => Corruption(System.Text.Encoding.UTF8.GetBytes(frame), binary);
    private static async Task Corruption(byte[] frame, bool binary = false)
    {
        await using var fixture = await ProtocolFixture.Open(); await using var protocol = await Connect(fixture);
        var first = protocol.Request("first", Json("{}")).AsTask(); await fixture.Receive(); var second = protocol.Request("second", Json("{}")).AsTask(); await fixture.Receive();
        await fixture.Send(frame, binary); var outcomes = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(5));
        Equal(outcomes.All(value => !value.IsSuccess), true, "invalid native response cancels every waiter, including the named request");
        Equal(protocol.Lifetime.IsCancellationRequested, true, "malformed protocol cannot continue with uncertain state");
    }
    private static async Task UnixSocket()
    {
        await using var fixture = await ProtocolFixture.Open(unix: true); await using var protocol = await Connect(fixture);
        Equal((await Roundtrip(fixture, protocol, "private-unix", "{}")).IsSuccess, true, "private Unix native transport shares the same protocol owner");
        var path = fixture.Endpoint[7..]; File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
        Equal((await WebSocketProtocol.Open(fixture.Endpoint, "", 1000, Callbacks())).IsSuccess, false, "world-readable socket is refused");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var link = Path.Combine(Path.GetDirectoryName(path)!, "linked.sock"); File.CreateSymbolicLink(link, path);
        Equal((await WebSocketProtocol.Open("unix://" + link, "", 1000, Callbacks())).IsSuccess, false, "symlink native socket is refused");
    }
}
