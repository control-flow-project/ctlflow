using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Crossfire.AdapterCodex;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using static Crossfire.Runtime.Tests.Checks;
using Results = Crossfire.Kernel.Results;

namespace Crossfire.Runtime.Tests;

public static class CodexAcceptance
{
    private sealed record ProviderCall(JsonElement Input, bool Held, TaskCompletionSource Release);
    public static async Task Verify()
    {
        var catalog = Environment.GetEnvironmentVariable("CROSSFIRE_TEST_MODEL_CATALOG") ?? throw new InvalidOperationException("Prepare the shared native catalog through verify-runtime.mjs");
        var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-real-codex-" + Guid.NewGuid().ToString("N")));
        try
        {
            var workspace = PrivateFiles.Directory(Path.Combine(directory, "workspace")); var state = PrivateFiles.Directory(Path.Combine(directory, "state")); var source = PrivateFiles.Directory(Path.Combine(directory, "host"));
            var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0"); await using var provider = builder.Build();
            var requests = Channel.CreateUnbounded<ProviderCall>(); var events = Channel.CreateUnbounded<NativeEvent>(); var holdNext = 0; var sequence = 0;
            provider.Run(async http =>
            {
                if (http.Request.Method != "POST" || http.Request.Path != "/v1/responses") { http.Response.StatusCode = 404; return; }
                using var document = await JsonDocument.ParseAsync(http.Request.Body, cancellationToken: http.RequestAborted);
                var call = new ProviderCall(document.RootElement.Clone(), Interlocked.Exchange(ref holdNext, 0) != 0,
                    new(TaskCreationOptions.RunContinuationsAsynchronously));
                var number = Interlocked.Increment(ref sequence).ToString(System.Globalization.CultureInfo.InvariantCulture);
                http.Response.ContentType = "text/event-stream"; http.Response.Headers.CacheControl = "no-cache";
                await http.Response.WriteAsync("event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"local-response-" + number + "\"}}\n\n", http.RequestAborted);
                await http.Response.Body.FlushAsync(http.RequestAborted); requests.Writer.TryWrite(call);
                if (call.Held) { try { await call.Release.Task.WaitAsync(http.RequestAborted); } catch (OperationCanceledException) { return; } }
                var item = "{\"type\":\"message\",\"id\":\"local-message-" + number + "\",\"role\":\"assistant\",\"status\":\"completed\",\"content\":[{\"type\":\"output_text\",\"text\":\"Local verification complete.\"}]}";
                await http.Response.WriteAsync("event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":" + item + "}\n\n", http.RequestAborted);
                await http.Response.WriteAsync("event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"local-response-" + number + "\",\"output\":[" + item + "],\"status\":\"completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1,\"total_tokens\":2}}}\n\n", http.RequestAborted);
            });
            await provider.StartAsync();
            try
            {
                var config = "model = 'fixture-model'\nmodel_reasoning_effort = 'medium'\nmodel_catalog_json = " + ProtocolJson.Quote(catalog) + "\nmodel_provider = 'fixture'\n[model_providers.fixture]\nname = 'Local verification'\nbase_url = "
                    + ProtocolJson.Quote(provider.Urls.Single() + "/v1") + "\nwire_api = 'responses'\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n";
                PrivateFiles.Write(Path.Combine(source, "config.toml"), Encoding.UTF8.GetBytes(config), 1048576);
                var prepared = ManagedHome.Prepare(state, source); Equal(prepared.IsSuccess, true, "real native private home is prepared without host changes"); var home = prepared.Value;
                Equal(ManagedHome.RefreshAuthentication(home, source).IsSuccess, true, "real native fixture has no host authentication");
                var binary = Environment.GetEnvironmentVariable("CROSSFIRE_TEST_CODEX") ?? "codex";
                using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(90));
                var native = await OwnedProcess.Start(home, workspace, state, "csharp-proof", binary, true, source, stop.Token); Equal(native.IsSuccess, true, native.IsSuccess ? "stock Codex owned process" : native.Error.Message);
                await using var owned = native.Value;
                var hooks = new RuntimeHooks((_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("invalid", "Unexpected native decision in inert local proof")));
                var options = CodexSettings.Parse(ModelAcceptance.Json("{\"model\":\"fixture-selected\",\"model_reasoning_effort\":\"max\",\"approval_policy\":\"never\",\"features\":{\"default_mode_request_user_input\":true}}")).Value;
                CodexConnection? inputConnection = null;
                var opened = await CodexSession.Open(owned.Endpoint, owned.Token, workspace, options, new CreateThread("C# native proof"), hooks, value => { events.Writer.TryWrite(value); inputConnection?.Event(value); }, stop.Token, 10000);
                Equal(opened.IsSuccess, true, opened.IsSuccess ? "native initialization and exact model admission" : opened.Error.Message);
                var session = opened.Value; var id = session.SessionId;
                try
                {
                    Equal(session.Approval, RuntimeApproval.None, "actual native approval policy is retained");
                    const string instructions = "Use the room tool for room replies. Preserve message provenance and do not expose private machine paths in shared rooms.";
                    var instructionJournal = Path.Combine(home, "instructions.json");
                    var applied = await NativeInstructions.Apply(session, home, instructionJournal, instructions, stop.Token);
                    Equal(applied.IsSuccess, true, applied.IsSuccess ? "native developer instructions have actual read-only history evidence" : applied.Error.Message);
                    Equal((await NativeInstructions.Apply(session, home, instructionJournal, instructions, stop.Token)).IsSuccess, true, "unchanged native developer instructions are not appended twice");
                    var read = CodexJson.ObjectReply(await session.Protocol.Request("thread/read", CodexJson.Object(writer => { writer.WriteString("threadId", id); writer.WriteBoolean("includeTurns", false); }), stop.Token));
                    var nativePath = read.Value.GetProperty("thread").GetProperty("path").GetString()!; var revisions = 0;
                    NativeHistory.Since(home, nativePath, null, record =>
                    {
                        if (CodexJson.String(record, "type") == "response_item" && record.TryGetProperty("payload", out var item) && CodexJson.String(item, "id")?.StartsWith("crossfire-instructions-", StringComparison.Ordinal) == true) revisions++;
                    });
                    Equal(revisions, 1, "stock Codex saves exactly one matching developer instruction revision");
                    Equal(requests.Reader.TryPeek(out _), false, "developer instruction injection does not execute a model turn");
                    var connection = CodexConnection.Open(session, Path.Combine(home, "delivery.json"), 100, 10000); Equal(connection.IsSuccess, true, "actual native delivery journal owner"); inputConnection = connection.Value;
                    var delivered = await inputConnection.Deliver("Inert native verification.", "csharp-native-message", stop.Token);
                    Equal(delivered.IsSuccess, true, delivered.IsSuccess ? "actual native API receipt confirmation" : delivered.Error.Message);
                    Equal((await inputConnection.Recover("Inert native verification.", "csharp-native-message", stop.Token)).Value, true, "actual native confirmed input recovery is content-bound");
                    Equal(inputConnection.Acknowledge(["csharp-native-message"]).IsSuccess, true, "actual native receipt is acknowledged after caller progress");
                    var request = await requests.Reader.ReadAsync(stop.Token); Equal(request.Input.GetProperty("model").GetString(), "fixture-selected", "actual native provider receives the exact selected model");
                    for (;;)
                    {
                        var observed = await events.Reader.ReadAsync(stop.Token); if (observed.Method != "turn/completed" || CodexJson.String(observed.Parameters, "threadId") != id) continue;
                        Equal(observed.Parameters.GetProperty("turn").GetProperty("status").GetString(), "completed", "real Codex finishes against only the inert loopback provider"); break;
                    }
                    Equal((await inputConnection.ActiveTurn()).Value is null, true, "completed native execution is not mistaken for a running old turn");
                    Interlocked.Exchange(ref holdNext, 1);
                    var working = inputConnection.Deliver("Hold this native turn until explicitly interrupted.", "csharp-held-message", stop.Token).AsTask();
                    var held = await requests.Reader.ReadAsync(stop.Token); Equal(held.Held, true, "the interruption fixture holds actual provider I/O, not an arbitrary delay");
                    Equal((await working).IsSuccess, true, "input can be confirmed while its model work remains active");
                    Equal(inputConnection.Acknowledge(["csharp-held-message"]).IsSuccess, true, "confirmed input remains confirmed independently of model completion");
                    var active = await inputConnection.ActiveTurn(admission: new(InputPriority.Steering, stop.Token));
                    Equal(active.IsSuccess && active.Value is not null, true, "the live native turn is observed before steering");
                    var interrupted = await inputConnection.Interrupt(active.Value!, admission: new(InputPriority.Steering, stop.Token));
                    Equal(interrupted.IsSuccess && interrupted.Value == "interrupted", true, interrupted.IsSuccess ? "native interruption is proved before replacement input" : interrupted.Error.Message);
                    Equal((await inputConnection.ActiveTurn()).Value is null, true, "an interrupted native turn is not still executing");
                    held.Release.TrySetResult();
                    var replacement = await inputConnection.Deliver("Replacement steering input after actual interruption.", "csharp-steering-message", stop.Token, InputPriority.Steering);
                    Equal(replacement.IsSuccess, true, replacement.IsSuccess ? "replacement input receives actual native evidence" : replacement.Error.Message);
                    await requests.Reader.ReadAsync(stop.Token); Equal(inputConnection.Acknowledge(["csharp-steering-message"]).IsSuccess, true, "replacement input is acknowledged separately");
                    var replacementTurn = (await CodexTimeline.Latest(session, stop.Token)).Value!.Id;
                    for (;;)
                    {
                        var completed = await events.Reader.ReadAsync(stop.Token);
                        if (completed.Method == "turn/completed" && CodexJson.String(completed.Parameters, "threadId") == id
                            && CodexJson.String(completed.Parameters.GetProperty("turn"), "id") == replacementTurn
                            && CodexJson.String(completed.Parameters.GetProperty("turn"), "status") == "completed") break;
                    }
                    Equal((await CodexTimeline.TurnStatus(session, active.Value!, stop.Token)).Value, "interrupted", "a late provider response cannot turn interrupted work into a completed old turn");
                    var invalid = await ModelAdmission.Read(session.Protocol, options with { Effort = "ultra" }, stop.Token); Equal(invalid.IsSuccess, false, "real native capability admission rejects unavailable effort");
                }
                finally { if (inputConnection is not null) await inputConnection.DisposeAsync(); else await session.DisposeAsync(); inputConnection = null; }
                var resumed = await CodexSession.Open(owned.Endpoint, owned.Token, workspace, options, new ResumeThread(id), hooks, _ => { }, stop.Token, 10000);
                Equal(resumed.IsSuccess, true, resumed.IsSuccess ? "same-process exact native session resume" : resumed.Error.Message);
                await using (var selected = resumed.Value) Equal(selected.SessionId, id, "resume never substitutes a new native history");
                await owned.DisposeAsync(); Equal(owned.Ended.IsCompletedSuccessfully, true, "the original native executable has actually stopped before process-restart recovery");
                await Restart(home, workspace, state, source, binary, id, options, hooks, requests.Reader, stop.Token);
                await OwnedCodexAcceptance.Verify(binary, source, workspace, directory, options.Native(), hooks, stop.Token);
                Equal(requests.Reader.TryPeek(out _), false, "context preparation, inspection and reset do not start unrequested model work");
            }
            finally { await provider.StopAsync(); }
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
    private static async Task Restart(string home, string workspace, string state, string source, string binary, string sessionId, CodexOptions options,
        RuntimeHooks hooks, ChannelReader<ProviderCall> requests, CancellationToken cancellation)
    {
        var restarted = await OwnedProcess.Start(home, workspace, state, "csharp-proof", binary, true, source, cancellation);
        Equal(restarted.IsSuccess, true, restarted.IsSuccess ? "a new native process opens the retained private home" : restarted.Error.Message); await using var native = restarted.Value;
        CodexConnection? connection = null;
        var opened = await CodexSession.Open(native.Endpoint, native.Token, workspace, options, new ResumeThread(sessionId), hooks, value => connection?.Event(value), cancellation, 10000);
        Equal(opened.IsSuccess, true, opened.IsSuccess ? "a new process resumes exactly the same saved history" : opened.Error.Message);
        var session = opened.Value;
        try
        {
            var boundary = await CodexTimeline.Boundary(session, cancellation); Equal(boundary.IsSuccess, true, "saved native history exposes its exact API boundary after restart");
            var file = Path.Combine(home, "restart.delivery.json");
            const string original = "Room !native-proof:example.test; sender @owner:example.test. Continue the exact unfinished original assignment, without repeating completed effects.";
            using (var journal = NativeJournal<CodexInput>.Open(file, sessionId, CodexInputCodec.Codec).Value)
                Equal(journal.Prepare(new(null, original, "csharp-unpublished-before-restart", boundary.Value.Boundary, boundary.Value.Initializing)).IsSuccess, true,
                    "a crash before native submission can retain the original source and text locally");
            await session.DisposeAsync(); await native.DisposeAsync();
            var next = await OwnedProcess.Start(home, workspace, state, "csharp-proof", binary, true, source, cancellation);
            Equal(next.IsSuccess, true, "second actual native process restart"); await using var current = next.Value;
            var resumed = await CodexSession.Open(current.Endpoint, current.Token, workspace, options, new ResumeThread(sessionId), hooks, value => connection?.Event(value), cancellation, 10000);
            Equal(resumed.IsSuccess, true, resumed.IsSuccess ? "unpublished original input retains its saved history identity" : resumed.Error.Message); session = resumed.Value;
            var prepared = CodexConnection.Open(session, file, 100, 10000); Equal(prepared.IsSuccess, true, "the new process owns the original pending input journal"); connection = prepared.Value;
            Equal((await connection.ActiveTurn()).Value is null, true, "a restarted executable has no old model execution to interrupt");
            var recovered = await connection.Settle(cancellation); Equal(recovered.IsSuccess && recovered.Value, true, recovered.IsSuccess ? "unknown original submission is recovered with a verified last-message instruction" : recovered.Error.Message);
            var call = await requests.ReadAsync(cancellation); var content = call.Input.GetRawText();
            Equal(content.Contains("crossfire-resume-", StringComparison.Ordinal) || content.Contains("resume-input/", StringComparison.Ordinal), true, "the resumed turn receives a retained original-input file, not a fabricated successful delivery");
            var journalState = NativeJournal<CodexInput>.Read(file, sessionId, CodexInputCodec.Codec).Value;
            Equal(journalState.Pending is null && journalState.Confirmed.Any(value => value.MessageId == "csharp-unpublished-before-restart"), true, "original input advances only after the new native turn actually records its restart instruction");
            Equal(connection.Acknowledge(["csharp-unpublished-before-restart"]).IsSuccess, true, "recovered original input remains explicitly acknowledged");
            var originals = Directory.GetFiles(Path.Combine(home, "resume-input"), "*.txt");
            Equal(originals.Length, 1, "one original-input file is retained for uncertain recovery"); Equal(File.ReadAllText(originals[0]), original, "the retained original message keeps its exact source and text");
        }
        finally { if (connection is not null) await connection.DisposeAsync(); else await session.DisposeAsync(); }
    }
}
