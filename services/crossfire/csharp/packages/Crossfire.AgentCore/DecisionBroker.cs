using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class DecisionBroker : IAsyncDisposable
{
    private sealed record Receipt(string Id, string Native, string Status);
    private readonly object gate = new();
    private readonly List<Receipt> receipts = [];
    private readonly HashSet<string> pending = new(StringComparer.Ordinal);
    private readonly AgentProfile profile;
    private readonly Coordination coordination;
    private readonly AgentMatrix matrix;
    private readonly LocalState storage;
    private readonly string file;
    private readonly TimeProvider clock;
    private readonly Func<CancellationToken, ValueTask<Result<string>>> run;
    private readonly CancellationTokenSource lifetime;
    private Task? running;
    private Task? closing;
    public DecisionBroker(AgentProfile profile, Coordination coordination, AgentMatrix matrix, LocalState storage, string file, TimeProvider clock, Func<CancellationToken, ValueTask<Result<string>>> run, CancellationToken stop)
    {
        this.profile = profile; this.coordination = coordination; this.matrix = matrix; this.storage = storage; this.file = file; this.clock = clock; this.run = run;
        if (storage.Exists(file))
        {
            var source = AgentIO.Read(storage, file); if (source.ValueKind != JsonValueKind.Array || source.GetArrayLength() > 4096) throw new InvalidDataException("Invalid native decision journal; retained decisions require owner inspection");
            foreach (var value in source.EnumerateArray())
            {
                if (!Validation.Fields(value, ["id", "native", "status"]).IsSuccess) throw new InvalidDataException("Invalid native decision journal");
                var id = WireJson.Text(value, "id"); var native = Validation.Text(value.GetProperty("native"), 1000); var status = Validation.Choice(value.GetProperty("status"), "pending", "responded", "cancelled");
                if (id is null || !Validation.Identifier(id) || !native.IsSuccess || !status.IsSuccess || receipts.Any(receipt => receipt.Id == id)) throw new InvalidDataException("Invalid native decision journal"); receipts.Add(new(id, native.Value, status.Value));
            }
        }
        lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop);
    }
    private static string Key(RuntimeDecision value) => WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue(value.Runtime); writer.WriteStringValue(value.Session); writer.WriteStringValue(value.Request); }));
    private void Save() => AgentIO.Write(storage, file, WireJson.Array(writer => { foreach (var value in receipts) { writer.WriteStartObject(); writer.WriteString("id", value.Id); writer.WriteString("native", value.Native); writer.WriteString("status", value.Status); writer.WriteEndObject(); } }));
    public bool Unresolved { get { lock (gate) return receipts.Any(value => value.Status == "pending"); } }
    public void Start()
    {
        TaskCompletionSource launch;
        lock (gate)
        {
            if (running is not null || closing is not null) return; for (var index = 0; index < receipts.Count; index++) if (receipts[index].Status == "pending") receipts[index] = receipts[index] with { Status = "cancelled" }; Save(); launch = new(TaskCreationOptions.RunContinuationsAsynchronously); running = launch.Task;
        }
        _ = Run(); async Task Run() { try { await Loop(); launch.TrySetResult(); } catch (Exception error) { launch.TrySetException(error); } }
    }
    private async Task Loop()
    {
        try { while (!lifetime.IsCancellationRequested) { await Flush(lifetime.Token); await Task.Delay(TimeSpan.FromSeconds(1), clock, lifetime.Token); } } catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }
    private async ValueTask<Result<Unit>> Flush(CancellationToken cancellation) => await AgentIO.Boundary(async () =>
    {
        Receipt[] selected; lock (gate) selected = receipts.Where(value => value.Status != "pending").ToArray();
        foreach (var receipt in selected)
        {
            var result = await coordination.Agent("receiptRuntimeDecision", profile.Id, WireJson.Object(writer => writer.WriteString("status", receipt.Status)), cancellation, new Dictionary<string, string> { ["decisionId"] = receipt.Id });
            if (result.IsSuccess || result.Error.Code is "missing" or "conflict") lock (gate) { receipts.Remove(receipt); Save(); } else return Result<Unit>.Fail(result.Error);
        }
        return Results.Done();
    });
    private void Status(string id, string status) { lock (gate) { var index = receipts.FindIndex(value => value.Id == id && value.Status == "pending"); if (index >= 0) { receipts[index] = receipts[index] with { Status = status }; Save(); } } }
    public void Responded(RuntimeDecision value) { lock (gate) { var receipt = receipts.FirstOrDefault(receipt => receipt.Native == Key(value) && receipt.Status == "pending"); if (receipt is not null) Status(receipt.Id, "responded"); } }
    public async ValueTask<Result<JsonElement>> Request(RuntimeDecision decision, CancellationToken cancellation)
    {
        if (string.IsNullOrEmpty(decision.Turn) || string.IsNullOrEmpty(decision.Item)) return Results.Fail<JsonElement>("invalid", "Native decisions require original turn and item identities");
        var key = Key(decision); var receipt = new Receipt(Identity.Identifier(), key, "pending");
        lock (gate) { if (!pending.Add(key)) return Results.Fail<JsonElement>("conflict", "The native request is already pending"); }
        var offered = false;
        using var expiry = decision.ExpiresMs is { } milliseconds ? new CancellationTokenSource(TimeSpan.FromMilliseconds(milliseconds), clock) : new CancellationTokenSource();
        using var scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, cancellation, expiry.Token);
        try
        {
            return await AgentIO.Boundary(async () =>
            {
                scope.Token.ThrowIfCancellationRequested(); var ready = await run(scope.Token); if (!ready.IsSuccess) return Result<JsonElement>.Fail(ready.Error); Start();
                lock (gate) { if (receipts.Count >= 4096) return Results.Fail<JsonElement>("limit", "Native decision receipt capacity reached; original decisions remain retained"); receipts.Add(receipt); Save(); }
                var authorized = await OwnerAuthority.Authorize(coordination, matrix, profile, scope.Token); if (!authorized.IsSuccess) return Result<JsonElement>.Fail(authorized.Error);
                IReadOnlyList<DecisionQuestion> questions = decision.Questions ?? [new("decision", decision.Action, "Review the complete native scope before selecting a choice.", false, false, decision.Choices.Select((choice, index) => new DecisionOption(index.ToString(System.Globalization.CultureInfo.InvariantCulture), choice.Label, "")).ToArray())];
                var created = await coordination.Agent("createRuntimeDecision", profile.Id, WireJson.Object(writer =>
                {
                    writer.WriteString("id", receipt.Id); writer.WriteString("runId", ready.Value); writer.WriteString("runtime", decision.Runtime); writer.WriteString("sessionId", decision.Session); writer.WriteString("requestId", decision.Request); writer.WriteString("turnId", decision.Turn); writer.WriteString("itemId", decision.Item); writer.WriteString("kind", decision.Questions is null ? "permission" : "question"); writer.WriteString("action", decision.Action); writer.WriteString("review", WireJson.Pretty(decision.Scope).TrimEnd('\n')); writer.WriteBoolean("blocking", decision.Blocking ?? true); AgentWire.Number(writer, "expiresAt", decision.ExpiresMs is null ? null : clock.GetUtcNow().ToUnixTimeMilliseconds() + decision.ExpiresMs.Value); writer.WritePropertyName("questions"); AgentWire.Questions(questions).WriteTo(writer);
                }), scope.Token);
                if (!created.IsSuccess) return created; var room = await OwnerAuthority.Conversation(coordination, matrix, profile, scope.Token); if (!room.IsSuccess) return Result<JsonElement>.Fail(room.Error);
                var page = coordination.Origin + "/manage/agents/" + profile.Id + "/decisions/" + receipt.Id; var links = questions.Count == 1 ? string.Join('\n', questions[0].Options.Select(option => option.Label + ": " + page + "?choice=" + Uri.EscapeDataString(option.Id))) : "";
                var notice = decision.Action + ": review and answer at " + page + ".\n\n" + string.Join("\n\n", questions.Select(question => question.Title + ": " + question.Prompt)) + (links.Length == 0 ? "" : "\n\n" + links) + "\n\nLinks only open a review. Submit explicitly. " + (decision.Blocking == true ? "The native request is waiting." : "This request is nonblocking and may expire.");
                var position = 0; foreach (var text in OwnerNotices.Chunks(notice)) { var sent = await AgentIO.Request(matrix, new("PUT", AgentWire.Room(room.Value) + "/send/m.room.message/" + receipt.Id + "-" + position++, OwnerNotices.Content(text)), scope.Token); if (!sent.IsSuccess) return sent; }
                for (;;)
                {
                    scope.Token.ThrowIfCancellationRequested(); var answer = await coordination.Agent("pollRuntimeDecision", profile.Id, null, scope.Token, new Dictionary<string, string> { ["decisionId"] = receipt.Id }); if (!answer.IsSuccess) return answer;
                    var status = WireJson.Text(answer.Value, "status");
                    if (status == "answered")
                    {
                        authorized = await OwnerAuthority.Authorize(coordination, matrix, profile, scope.Token); if (!authorized.IsSuccess) return Result<JsonElement>.Fail(authorized.Error); scope.Token.ThrowIfCancellationRequested();
                        if (!answer.Value.TryGetProperty("answers", out var rows) || rows.ValueKind != JsonValueKind.Array) return Results.Fail<JsonElement>("invalid", "Invalid native decision answer");
                        var values = rows.EnumerateArray().ToArray(); if (values.Length != questions.Count || values.Any(value => value.ValueKind != JsonValueKind.Object) || values.Select(value => WireJson.Text(value, "questionId")).Distinct(StringComparer.Ordinal).Count() != values.Length) return Results.Fail<JsonElement>("invalid", "Incomplete or duplicated native answers");
                        if (decision.Questions is null)
                        {
                            var selected = WireJson.Text(values[0], "optionId"); if (!int.TryParse(selected, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var index) || index < 0 || index >= decision.Choices.Count || index.ToString(System.Globalization.CultureInfo.InvariantCulture) != selected || WireJson.Text(values[0], "questionId") != "decision") return Results.Fail<JsonElement>("invalid", "Native choice is unavailable");
                            offered = true; return Result<JsonElement>.Success(decision.Choices[index].Value.Clone());
                        }
                        var responses = new Dictionary<string, string>(StringComparer.Ordinal);
                        foreach (var question in questions)
                        {
                            var row = values.FirstOrDefault(value => WireJson.Text(value, "questionId") == question.Id); var text = WireJson.Text(row, "text"); var option = WireJson.Text(row, "optionId");
                            if (text is not null && (!question.AllowText || option is not null)) return Results.Fail<JsonElement>("invalid", "Text was not offered for this native question");
                            text ??= question.Options.FirstOrDefault(value => value.Id == option)?.Label; if (text is null) return Results.Fail<JsonElement>("invalid", "Incomplete native answer"); responses.Add(question.Id, text);
                        }
                        offered = true; return Result<JsonElement>.Success(WireJson.Object(writer => { writer.WriteStartObject("answers"); foreach (var response in responses) { writer.WriteStartObject(response.Key); writer.WriteStartArray("answers"); writer.WriteStringValue(response.Value); writer.WriteEndArray(); writer.WriteEndObject(); } writer.WriteEndObject(); }));
                    }
                    if (status != "pending") return Results.Fail<JsonElement>("conflict", "Original native request is no longer pending"); await Task.Delay(TimeSpan.FromSeconds(1), clock, scope.Token);
                }
            });
        }
        finally { lock (gate) pending.Remove(key); if (!offered) Status(receipt.Id, "cancelled"); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; } if (completion is not null) _ = Finish(completion); return new(selected);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close()
    {
        List<Exception> errors = []; async Task Finish(Func<Task> action) { try { await action(); } catch (Exception error) { errors.Add(error); } }
        await Finish(lifetime.CancelAsync); await Finish(() => { lock (gate) { for (var index = 0; index < receipts.Count; index++) if (receipts[index].Status == "pending") receipts[index] = receipts[index] with { Status = "cancelled" }; Save(); } return Task.CompletedTask; });
        var pending = running; if (pending is not null) await Finish(() => pending); using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15), clock); try { await Finish(async () => { await Flush(deadline.Token); }); } finally { lifetime.Dispose(); }
        if (errors.Count != 0) throw new AggregateException("Owner decision shutdown requires inspection", errors);
    }
}
