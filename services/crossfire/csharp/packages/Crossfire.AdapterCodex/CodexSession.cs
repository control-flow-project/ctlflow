using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public abstract record ThreadSelection;
public sealed record CreateThread(string Name) : ThreadSelection;
public sealed record ResumeThread(string Id) : ThreadSelection;

public sealed class CodexSession : IAsyncDisposable
{
    private readonly RuntimeHooks hooks;
    private readonly Action<NativeEvent> events;
    private readonly NativeObservation observer;
    private readonly object gate = new();
    private readonly Dictionary<string, JsonElement> changes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, RuntimeDecision> decisions = new(StringComparer.Ordinal);
    private WebSocketProtocol? protocol;
    private CancellationTokenRegistration failure;
    public string SessionId { get; private set; }
    public string Workspace { get; }
    public RuntimeApproval Approval { get; private set; }
    public CancellationToken Lifetime => protocol!.Lifetime;
    public CodexProtocol Protocol => protocol ?? throw new InvalidOperationException("Codex has not initialized");
    private CodexSession(string workspace, string id, RuntimeHooks hooks, Action<NativeEvent> events)
    { Workspace = workspace; SessionId = id; this.hooks = hooks; this.events = events; observer = new(hooks, () => SessionId, Identity.Now); }

    public static async ValueTask<Result<CodexSession>> Open(string endpoint, string token, string workspace, CodexOptions options, ThreadSelection selection,
        RuntimeHooks hooks, Action<NativeEvent> events, CancellationToken cancellation, int timeoutMs = 30000)
    {
        if (selection is ResumeThread saved && !Guid.TryParseExact(saved.Id, "D", out _) || selection is CreateThread created && created.Name.Length == 0)
            return Results.Fail<CodexSession>("invalid", "Supply the exact saved Codex session UUID or new session name");
        var owner = new CodexSession(PrivateFiles.ExistingDirectory(workspace, false), selection is ResumeThread prior ? prior.Id : "", hooks, events);
        var opened = await WebSocketProtocol.Open(endpoint, token, timeoutMs, new(owner.Event, owner.Decision, owner.Responded), cancellation);
        if (!opened.IsSuccess) { owner.observer.Dispose(); return Result<CodexSession>.Fail(opened.Error); }
        owner.protocol = opened.Value;
        try
        {
            var result = await owner.Initialize(options, selection, cancellation);
            if (result.IsSuccess) return Result<CodexSession>.Success(owner);
            await owner.DisposeAsync(); return Result<CodexSession>.Fail(result.Error);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or ArgumentException or KeyNotFoundException or OperationCanceledException)
        { await owner.DisposeAsync(); return Results.Fail<CodexSession>("native", "Codex did not initialize the exact requested native session, workspace and settings"); }
    }
    private async ValueTask<Result<Unit>> Initialize(CodexOptions options, ThreadSelection selection, CancellationToken cancellation)
    {
        var initialized = CodexJson.ObjectReply(await Protocol.Request("initialize", CodexJson.Object(writer =>
        {
            writer.WriteStartObject("clientInfo"); writer.WriteString("name", "crossfire"); writer.WriteString("title", "crossfire listener"); writer.WriteString("version", "0.1.20"); writer.WriteEndObject();
            writer.WriteStartObject("capabilities"); writer.WriteBoolean("experimentalApi", true); writer.WriteEndObject();
        }), cancellation));
        if (!initialized.IsSuccess) return Result<Unit>.Fail(initialized.Error);
        var notification = await Protocol.Notify("initialized", cancellation); if (!notification.IsSuccess) return notification;
        var admitted = await ModelAdmission.Read(Protocol, options, cancellation); if (!admitted.IsSuccess) return Result<Unit>.Fail(admitted.Error);
        var selected = CodexJson.ObjectReply(await Protocol.Request(selection is CreateThread ? "thread/start" : "thread/resume", CodexJson.Object(writer =>
        {
            writer.WriteString("cwd", Workspace); writer.WriteStartObject("config");
            foreach (var field in options.Native().EnumerateObject()) if (field.Name is not ("model" or "model_reasoning_effort")) field.WriteTo(writer);
            writer.WriteString("model", admitted.Value.Model); writer.WriteString("model_reasoning_effort", admitted.Value.Effort); writer.WriteEndObject();
            if (selection is ResumeThread saved) { writer.WriteString("threadId", saved.Id); writer.WriteBoolean("excludeTurns", true); }
            else { writer.WriteString("historyMode", "paginated"); writer.WriteBoolean("ephemeral", false); }
        }), cancellation));
        if (!selected.IsSuccess) return Result<Unit>.Fail(selected.Error);
        var value = selected.Value; var id = value.TryGetProperty("thread", out var thread) ? CodexJson.String(thread, "id") : null;
        if (id is null || !Guid.TryParseExact(id, "D", out _) || selection is ResumeThread existing && id != existing.Id) return Results.Fail<Unit>("native", "Codex did not select the requested session");
        SessionId = id; var approval = CodexSettings.Approval(value.GetProperty("approvalPolicy")); if (!approval.IsSuccess) return Result<Unit>.Fail(approval.Error); Approval = approval.Value;
        var sandbox = options.Sandbox switch { "danger-full-access" => "dangerFullAccess", "workspace-write" => "workspaceWrite", "read-only" => "readOnly", _ => throw new InvalidOperationException("Invalid selected sandbox") };
        if (CodexJson.String(value, "model") != admitted.Value.Model || CodexJson.String(value, "reasoningEffort") != admitted.Value.Effort
            || CodexJson.String(value.GetProperty("sandbox"), "type") != sandbox || CodexJson.String(value, "approvalPolicy") != options.ApprovalPolicy)
            return Results.Fail<Unit>("invalid", "Codex did not apply the selected model, reasoning, sandbox and approval settings; no model or effort was substituted");
        observer.Configure(options, value, CodexJson.String(initialized.Value, "userAgent"));
        if (selection is CreateThread created)
        {
            var named = await Protocol.Request("thread/name/set", CodexJson.Object(writer => { writer.WriteString("threadId", SessionId); writer.WriteString("name", created.Name); }), cancellation);
            if (!named.IsSuccess) return Result<Unit>.Fail(named.Error); if (named.Value.Error is { } error) return Results.Fail<Unit>("native", "Codex did not save its native session name: " + error.Message);
        }
        var read = CodexJson.ObjectReply(await Protocol.Request("thread/read", CodexJson.Object(writer => { writer.WriteString("threadId", SessionId); writer.WriteBoolean("includeTurns", selection is CreateThread); }), cancellation));
        if (!read.IsSuccess) return Result<Unit>.Fail(read.Error);
        var loaded = read.Value.GetProperty("thread"); var state = CodexJson.String(loaded.GetProperty("status"), "type");
        if (CodexJson.String(loaded, "id") != SessionId || !loaded.GetProperty("canAcceptDirectInput").GetBoolean() || state is not ("idle" or "active")
            || PrivateFiles.ExistingDirectory(CodexJson.String(loaded, "cwd") ?? "", false) != Workspace) return Results.Fail<Unit>("native", "The selected Codex session must be loaded in this exact workspace");
        observer.State(state == "idle" ? "idle" : "working");
        failure = Lifetime.Register(() => { if (!cancellation.IsCancellationRequested) observer.State("failed", "Native Codex connection ended unexpectedly"); });
        return Results.Done();
    }
    private void Event(NativeEvent value)
    {
        if (CodexJson.String(value.Parameters, "threadId") == SessionId && value.Method is "item/started" or "item/completed"
            && value.Parameters.TryGetProperty("item", out var item) && CodexJson.String(item, "type") == "fileChange")
        {
            var id = CodexJson.String(item, "id"); if (string.IsNullOrEmpty(id)) throw new InvalidDataException("Invalid pending native file identity");
            lock (gate) { if (value.Method == "item/completed") changes.Remove(id); else changes[id] = item.GetProperty("changes").Clone(); }
        }
        observer.Event(value); events(value);
    }
    private async ValueTask<Result<JsonElement>> Decision(NativeRequest request, CancellationToken cancellation)
    {
        JsonElement? files = null; var itemId = CodexJson.String(request.Parameters, "itemId"); lock (gate) if (itemId is not null && changes.TryGetValue(itemId, out var pending)) files = pending;
        var decoded = NativeDecisions.Decode(request, SessionId, files); if (!decoded.IsSuccess) return Result<JsonElement>.Fail(decoded.Error);
        var response = await hooks.RequestDecision(decoded.Value, cancellation);
        if (!response.IsSuccess)
        {
            var denied = decoded.Value.Questions is null ? NativeDecisions.Denial(decoded.Value) : null;
            return denied is null ? response : Result<JsonElement>.Success(denied.Value);
        }
        if (!NativeDecisions.ValidAnswer(decoded.Value, response.Value)) return Results.Fail<JsonElement>("invalid", "Response is not a native available decision");
        lock (gate) decisions[CodexJson.Identity(request.Id)] = decoded.Value;
        return response;
    }
    private void Responded(NativeRequest request)
    {
        RuntimeDecision? decision; lock (gate) decisions.Remove(CodexJson.Identity(request.Id), out decision);
        if (decision is not null) hooks.DecisionResponded?.Invoke(decision);
    }
    public async ValueTask DisposeAsync()
    {
        await failure.DisposeAsync(); if (protocol is not null) await protocol.DisposeAsync(); observer.Dispose(); lock (gate) { changes.Clear(); decisions.Clear(); }
    }
}
