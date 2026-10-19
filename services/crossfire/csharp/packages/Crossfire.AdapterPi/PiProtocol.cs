using System.Buffers;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed class PiProtocol : IAsyncDisposable
{
    private sealed class Pending(string id, string command)
    {
        public string Id { get; } = id;
        public string Command { get; } = command;
        public TaskCompletionSource<Result<JsonElement>> Response { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ITimer? Deadline { get; set; }
    }
    public const int MaximumFrame = 33554432;
    private readonly NativeProcess process;
    private readonly Action<JsonElement> events;
    private readonly TimeProvider time;
    private readonly int timeout;
    private readonly CancellationTokenSource stop = new();
    private readonly CancellationTokenRegistration parent;
    private readonly SemaphoreSlim writing = new(1);
    private readonly Dictionary<string, Pending> requests = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Pending> controls = new(StringComparer.Ordinal);
    private readonly object gate = new();
    private readonly Task reading;
    private readonly Task errors;
    private readonly Task exited;
    private readonly TaskCompletionSource drained = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource initialized = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Failure? failure;
    private Task? closing;
    private int operating;
    public CancellationToken Lifetime { get; }
    public string Version => "1.0.0";
    public int ProcessId => process.Id;
    private PiProtocol(NativeProcess process, Action<JsonElement> events, int timeout, TimeProvider time, CancellationToken cancellation)
    {
        this.process = process; this.events = events; this.timeout = timeout; this.time = time; Lifetime = stop.Token;
        reading = Read(); errors = Errors(); exited = Exit(); parent = cancellation.Register(() => Fail(new("native", "Owned Pi runtime was cancelled")));
        initialized.TrySetResult();
    }
    public static async ValueTask<Result<PiProtocol>> Start(string binary, string home, string workspace, string state, string profile, string history,
        string instructions, Action<JsonElement> events, CancellationToken cancellation, int timeoutMs = 30000, TimeProvider? time = null)
    {
        if (timeoutMs is < 100 or > 300000) return Results.Fail<PiProtocol>("invalid", "Pi request deadline must be finite");
        try
        {
            PrivateFiles.ExistingDirectory(home, true); PrivateFiles.ExistingDirectory(workspace, false); PrivateFiles.ExistingDirectory(state, true);
            var environment = PiValues.Environment(home, state, profile);
            var version = await NativeProcess.Capture(new(binary, ["--version"], workspace, environment), 4096, 10000, cancellation);
            if (!version.IsSuccess || version.Value.ExitCode != 0 || version.Value.Output.Trim() != "1.0.0") return Results.Fail<PiProtocol>("invalid", "Pi requires verified @earendil-works/pi-coding-agent 1.0.0; other native protocols have not been admitted");
            var extension = Path.Combine(home, "crossfire-extension.mjs"); var prompt = Path.Combine(home, "crossfire-instructions.txt");
            PrivateFiles.Write(extension, Encoding.UTF8.GetBytes(PiValues.Extension()), 1048576); PrivateFiles.Write(prompt, Encoding.UTF8.GetBytes(instructions), 8388608);
            var native = Crossfire.AdapterRuntime.NativeGuard.Start(new(binary, ["--mode", "rpc", "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-approve",
                "--session", history, "--append-system-prompt", prompt, "--extension", extension], workspace, environment, Input: true), home,
                Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(history))));
            return native.IsSuccess ? Result<PiProtocol>.Success(new(native.Value, events, timeoutMs, time ?? TimeProvider.System, cancellation)) : Result<PiProtocol>.Fail(native.Error);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or OperationCanceledException)
        { return Results.Fail<PiProtocol>("native", "Cannot start the exact owned Pi RPC runtime: " + error.Message); }
    }
    private static bool Recoverable(Exception error) => error is not (OutOfMemoryException or StackOverflowException or AccessViolationException);
    private Failure Error { get { lock (gate) return failure ?? new("native", "Pi operation stopped before confirmation"); } }
    public void Fail(Failure error)
    {
        Pending[] waiting;
        lock (gate) { if (failure is not null) return; failure = error; waiting = requests.Values.Concat(controls.Values).ToArray(); requests.Clear(); controls.Clear(); }
        try { stop.Cancel(); }
        finally { foreach (var pending in waiting) { pending.Deadline?.Dispose(); pending.Response.TrySetResult(Result<JsonElement>.Fail(error)); } _ = DisposeAsync(); }
    }
    private async Task Exit()
    { await initialized.Task; try { await process.Ended; Fail(new("native", "Owned Pi process exited")); } catch (Exception error) when (Recoverable(error)) { Fail(new("native", "Owned Pi exit could not be observed")); } }
    private async Task Errors()
    {
        await initialized.Task;
        var bytes = new byte[8192];
        try { while (await process.Errors.BaseStream.ReadAsync(bytes, Lifetime) != 0) { } }
        catch (Exception error) when (Recoverable(error)) { if (!Lifetime.IsCancellationRequested) Fail(new("native", "Owned Pi diagnostic pipe failed")); }
    }
    private async Task Read()
    {
        await initialized.Task;
        var chunk = ArrayPool<byte>.Shared.Rent(65536); var frame = new ArrayBufferWriter<byte>();
        try
        {
            for (;;)
            {
                var count = await process.Output.BaseStream.ReadAsync(chunk.AsMemory(0, 65536), Lifetime);
                if (count == 0) { Fail(new("native", "Owned Pi output pipe closed")); return; }
                for (var start = 0; start < count;)
                {
                    var next = chunk.AsSpan(start, count - start).IndexOf((byte)10); var end = next < 0 ? count : start + next;
                    if ((long)frame.WrittenCount + end - start > MaximumFrame) throw new IOException("Native Pi protocol frame exceeds its finite byte budget");
                    frame.Write(chunk.AsSpan(start, end - start)); if (next < 0) break;
                    if (frame.WrittenCount != 0)
                    {
                        var text = new UTF8Encoding(false, true).GetString(frame.WrittenSpan); using var document = JsonDocument.Parse(text); Event(document.RootElement.Clone());
                    }
                    frame.Clear(); start = end + 1;
                }
            }
        }
        catch (Exception error) when (Recoverable(error)) { if (!Lifetime.IsCancellationRequested) Fail(new("native", "Invalid native Pi protocol frame: " + PiValues.ErrorText(error.Message))); }
        finally { ArrayPool<byte>.Shared.Return(chunk); }
    }
    private void Event(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Invalid native Pi object");
        if (PiValues.Text(value, "type") == "response")
        {
            var id = PiValues.Text(value, "id") ?? throw new InvalidDataException("Uncorrelated native Pi response"); Pending? pending;
            lock (gate) requests.TryGetValue(id, out pending); if (pending is null) return;
            if (PiValues.Text(value, "command") != pending.Command || !value.TryGetProperty("success", out var success) || success.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new InvalidDataException("Mismatched native Pi response");
            lock (gate) requests.Remove(id); pending.Deadline?.Dispose();
            pending.Response.TrySetResult(success.GetBoolean() ? Result<JsonElement>.Success(value.TryGetProperty("data", out var data) ? data.Clone() : PiValues.Null)
                : Results.Fail<JsonElement>("native", PiValues.ErrorText("Pi " + pending.Command + " failed: " + (PiValues.Text(value, "error") ?? "Unknown native error"))));
            return;
        }
        if (PiValues.Text(value, "type") == "extension_ui_request" && PiValues.Text(value, "method") == "notify" && PiValues.Text(value, "message") is { } message)
        {
            if (message.StartsWith("{\"crossfire\":true,", StringComparison.Ordinal))
            {
                using var document = JsonDocument.Parse(message); var reply = document.RootElement; var id = PiValues.Text(reply, "id"); if (id is null) return; Pending? pending;
                lock (gate) controls.TryGetValue(id, out pending); if (pending is null) return;
                if (!reply.TryGetProperty("crossfire", out var flag) || flag.ValueKind != JsonValueKind.True || !reply.TryGetProperty("data", out var data)) throw new InvalidDataException("Invalid Pi private control reply");
                lock (gate) controls.Remove(id); pending.Deadline?.Dispose(); pending.Response.TrySetResult(Result<JsonElement>.Success(data.Clone())); return;
            }
            if (message.StartsWith("{\"crossfireEvent\":\"interruption\",", StringComparison.Ordinal))
            {
                using var document = JsonDocument.Parse(message); var turn = PiValues.Text(document.RootElement, "turn") ?? throw new InvalidDataException("Invalid Pi captured interruption event");
                events(PiValues.Object(writer => { writer.WriteString("type", "interruption_started"); writer.WriteString("turn", turn); })); return;
            }
        }
        events(value);
    }
    private bool Enter()
    { lock (gate) { if (failure is not null || closing is not null || operating >= 256) return false; operating++; return true; } }
    private void Leave() { lock (gate) { operating--; if (closing is not null && operating == 0) drained.TrySetResult(); } }
    private Result<Pending> Register(Dictionary<string, Pending> map, string command, bool readOnly = false)
    {
        lock (gate)
        {
            if (failure is not null) return Result<Pending>.Fail(failure); if (map.Count >= 64) return Results.Fail<Pending>("limit", "Pi native request capacity is exhausted");
            var pending = new Pending(Identity.Identifier(), command); map.Add(pending.Id, pending);
            pending.Deadline = time.CreateTimer(_ =>
            {
                if (!readOnly) Fail(new("unavailable", "Native Pi command timed out before confirmation"));
                else { Forget(map, pending); pending.Response.TrySetResult(Results.Fail<JsonElement>("unavailable", "Native Pi metadata request timed out")); }
            }, null, TimeSpan.FromMilliseconds(timeout), Timeout.InfiniteTimeSpan);
            return Result<Pending>.Success(pending);
        }
    }
    private void Forget(Dictionary<string, Pending> map, Pending pending)
    { lock (gate) map.Remove(pending.Id); pending.Deadline?.Dispose(); }
    public ValueTask<Result<Unit>> Notify(JsonElement value, CancellationToken cancellation = default) => Write(value, cancellation);
    private async ValueTask<Result<Unit>> Write(JsonElement value, CancellationToken cancellation, Action? started = null)
    {
        if (!Enter()) return Result<Unit>.Fail(Error);
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(Lifetime, cancellation);
        var began = false;
        try
        {
            if (value.ValueKind != JsonValueKind.Object) return Results.Fail<Unit>("invalid", "Native Pi commands require an object");
            var bytes = JsonSerializer.SerializeToUtf8Bytes(value, PiJsonContext.Default.JsonElement); if (bytes.Length > MaximumFrame) return Results.Fail<Unit>("limit", "Native Pi command exceeds its finite byte budget");
            await writing.WaitAsync(scope.Token);
            try { scope.Token.ThrowIfCancellationRequested(); began = true; started?.Invoke(); await process.Input.BaseStream.WriteAsync(bytes, Lifetime); await process.Input.BaseStream.WriteAsync("\n"u8.ToArray(), Lifetime); await process.Input.BaseStream.FlushAsync(Lifetime); }
            finally { writing.Release(); }
            return Results.Done();
        }
        catch (Exception error) when (Recoverable(error)) { if (began || !cancellation.IsCancellationRequested) Fail(new("native", "Owned Pi command pipe failed")); return Result<Unit>.Fail(Error); }
        finally { Leave(); }
    }
    public ValueTask<Result<JsonElement>> Request(string command, JsonElement parameters, CancellationToken cancellation = default) => RequestTracked(command, parameters, cancellation);
    private async ValueTask<Result<JsonElement>> RequestTracked(string command, JsonElement parameters, CancellationToken cancellation, Action? publicationStarted = null)
    {
        if (!Enter()) return Result<JsonElement>.Fail(Error);
        Pending? reading = null;
        try
        {
            if (parameters.ValueKind != JsonValueKind.Object || string.IsNullOrEmpty(command) || command.Length > 200) return Results.Fail<JsonElement>("invalid", "Invalid native Pi command and parameters");
            if (cancellation.IsCancellationRequested) return Results.Fail<JsonElement>("unavailable", "Pi request was cancelled before acceptance");
            var readOnly = command is "get_state" or "get_available_models";
            var registered = Register(requests, command, readOnly); if (!registered.IsSuccess) return Result<JsonElement>.Fail(registered.Error); var pending = registered.Value;
            if (readOnly) reading = pending;
            var began = false;
            var written = await Write(PiValues.Object(writer => { foreach (var field in parameters.EnumerateObject()) if (field.Name is not ("type" or "id")) field.WriteTo(writer); writer.WriteString("type", command); writer.WriteString("id", pending.Id); }), cancellation,
                () => { began = true; publicationStarted?.Invoke(); });
            if (!written.IsSuccess) { if (!began) Forget(requests, pending); return Result<JsonElement>.Fail(written.Error); }
            using var scope = CancellationTokenSource.CreateLinkedTokenSource(Lifetime, cancellation); return await pending.Response.Task.WaitAsync(scope.Token);
        }
        catch (OperationCanceledException) { return Results.Fail<JsonElement>("unavailable", "Pi request stopped before confirmation"); }
        finally { if (reading is not null) Forget(requests, reading); Leave(); }
    }
    public async ValueTask<Result<JsonElement>> Control(string operation, JsonElement parameters, CancellationToken cancellation = default)
    {
        if (!Enter()) return Result<JsonElement>.Fail(Error);
        try
        {
            if (parameters.ValueKind != JsonValueKind.Object || string.IsNullOrEmpty(operation) || operation.Length > 200) return Results.Fail<JsonElement>("invalid", "Invalid native Pi control and parameters");
            if (cancellation.IsCancellationRequested) return Results.Fail<JsonElement>("unavailable", "Pi control was cancelled before acceptance");
            var registered = Register(controls, operation); if (!registered.IsSuccess) return Result<JsonElement>.Fail(registered.Error); var pending = registered.Value;
            var payload = PiValues.Object(writer => { foreach (var field in parameters.EnumerateObject()) if (field.Name is not ("operation" or "id")) field.WriteTo(writer); writer.WriteString("id", pending.Id); writer.WriteString("operation", operation); });
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(payload.GetRawText())).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var began = false;
            var requested = await RequestTracked("prompt", PiValues.Object(writer => writer.WriteString("message", "/crossfire-control " + encoded)), cancellation, () => began = true);
            if (!requested.IsSuccess) { if (!began) Forget(controls, pending); return requested; }
            using var scope = CancellationTokenSource.CreateLinkedTokenSource(Lifetime, cancellation); return await pending.Response.Task.WaitAsync(scope.Token);
        }
        catch (OperationCanceledException) { return Results.Fail<JsonElement>("unavailable", "Pi control stopped before confirmation"); }
        finally { Leave(); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = Close(completion); return new(selected);
    }
    private async Task Close(TaskCompletionSource completion)
    {
        await initialized.Task;
        try
        {
            Fail(new("native", "Owned Pi connection closed")); await parent.DisposeAsync(); await process.StopAsync(); await Task.WhenAll(reading, errors, exited);
            lock (gate) if (operating == 0) drained.TrySetResult(); await drained.Task; await process.DisposeAsync(); writing.Dispose(); stop.Dispose(); completion.TrySetResult();
        }
        catch (Exception error) { try { await process.DisposeAsync(); } finally { completion.TrySetException(error); } }
    }
}

[System.Text.Json.Serialization.JsonSerializable(typeof(JsonElement))]
internal partial class PiJsonContext : System.Text.Json.Serialization.JsonSerializerContext;
